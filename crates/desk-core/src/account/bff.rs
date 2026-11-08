//! The platform's auth endpoints (api-gateway `/api/v1/auth/*` → identity-service), as
//! refs/auth.md §2.3 cites them, and the rules for their answers. A failure other than 400, 401,
//! 403 and 410 (a server error, 408, 429, no connection) is tried again after each wait of
//! `retry` (400, 1200 and 3000 ms) before it counts. Errors come in the platform's envelope,
//! `{ "error": { "code": "DEVICE_CODE_EXPIRED", ... } }`.

use std::thread;
use std::time::Duration;

use serde_json::{Value, json};

use super::{Problem, cookie};
use crate::account_client::{Call, IdClient, Reply};

pub(super) struct Bff<'a> {
    pub platform: &'a str,
    pub retry: &'a [Duration],
    pub client: &'a dyn IdClient,
}

/// A code from `/device/start`.
pub(super) struct Start {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: String,
    pub expires_in: u64,
    pub interval: u64,
}

/// A session's token and its cookie, from the device flow or a refresh.
pub(super) struct Tokens {
    pub access_token: String,
    pub expires_in: u64,
    /// The rotated `endue_rt`, when the reply set one.
    pub cookie: Option<String>,
}

/// One poll of `/device/token`.
pub(super) enum Polled {
    /// Not yet; poll again after this many seconds.
    Pending(u64),
    Tokens(Tokens),
    /// The sign-in is over: expired, denied, suspended or failed.
    Ended(Problem),
    /// Endue could not answer this time; the code still holds.
    Transient(Problem),
}

/// What `/refresh` said, after its retries.
pub(super) enum Renewed {
    Tokens(Tokens),
    /// 400 or 401: the session is over.
    Ended,
    /// 403: refused, but the session is kept.
    Rejected,
    Transient(Problem),
}

impl Bff<'_> {
    fn url(&self, path: &str) -> String {
        format!("{}{path}", self.platform)
    }

    /// `call`, made again after each wait of `retry` while it fails in a way worth retrying.
    fn retried(&self, call: &Call) -> Result<Reply, String> {
        let mut result = self.client.send(call);
        for wait in self.retry {
            if !retryable(&result) {
                break;
            }
            thread::sleep(*wait);
            result = self.client.send(call);
        }
        result
    }

    /// Ask for a code with the PKCE `challenge`.
    pub fn start(&self, challenge: &str) -> Result<Start, Problem> {
        let body = json!({ "code_challenge": challenge, "code_challenge_method": "S256" });
        let call = Call::post(self.url("/api/v1/auth/device/start"), body);
        let result = self.retried(&call);
        let reply = match &result {
            Ok(reply) if reply.status == 200 => reply.json(),
            _ => return Err(problem_of(&result)),
        };
        let text = |key: &str| reply.get(key).and_then(Value::as_str).map(str::to_owned);
        let (Some(device_code), Some(user_code), Some(verification_uri)) = (
            text("device_code"),
            text("user_code"),
            text("verification_uri"),
        ) else {
            return Err(Problem::Failed);
        };
        let verification_uri_complete = text("verification_uri_complete").unwrap_or_else(|| {
            let join = if verification_uri.contains('?') {
                '&'
            } else {
                '?'
            };
            format!("{verification_uri}{join}user_code={user_code}")
        });
        let number = |key: &str| reply.get(key).and_then(Value::as_u64);
        Ok(Start {
            device_code,
            user_code,
            verification_uri,
            verification_uri_complete,
            expires_in: number("expires_in").unwrap_or(600),
            interval: number("interval").unwrap_or(5).clamp(1, 600),
        })
    }

    /// One poll, sending the interval in use so a slow_down comes back five seconds longer.
    pub fn poll(&self, device_code: &str, verifier: &str, interval: u64) -> Polled {
        let body = json!({ "device_code": device_code, "code_verifier": verifier,
            "interval": interval });
        let result = self
            .client
            .send(&Call::post(self.url("/api/v1/auth/device/token"), body));
        match &result {
            Ok(reply) if reply.status == 202 => {
                let next = reply.json().get("interval").and_then(Value::as_u64);
                Polled::Pending(next.unwrap_or(interval).clamp(1, 600))
            }
            Ok(reply) if reply.status == 200 => {
                tokens_of(reply).map_or(Polled::Ended(Problem::Failed), Polled::Tokens)
            }
            _ if retryable(&result) => Polled::Transient(problem_of(&result)),
            _ => Polled::Ended(problem_of(&result)),
        }
    }

    /// Renew the session that `endue_rt=<cookie>` holds; the reply rotates the cookie.
    pub fn refresh(&self, cookie_value: &str) -> Renewed {
        let call = Call::post(self.url("/api/v1/auth/refresh"), json!({}))
            .header("cookie", cookie::header(cookie_value));
        let result = self.retried(&call);
        match &result {
            Ok(reply) if reply.status == 200 => {
                tokens_of(reply).map_or(Renewed::Transient(Problem::Failed), Renewed::Tokens)
            }
            Ok(reply) if matches!(reply.status, 400 | 401) => Renewed::Ended,
            Ok(reply) if reply.status == 403 => Renewed::Rejected,
            _ => Renewed::Transient(problem_of(&result)),
        }
    }

    /// Revoke the session on the server (Keycloak revoke and logout); failures change nothing.
    pub fn logout(&self, cookie_value: &str) {
        let call = Call::post(self.url("/api/v1/auth/logout"), json!({}))
            .header("cookie", cookie::header(cookie_value));
        let _ = self.client.send(&call);
    }

    /// `GET /api/v1/users/me` as the person: the profile's fields, or `None`.
    pub fn me(&self, access_token: &str) -> Option<Value> {
        let call = Call::get(self.url("/api/v1/users/me"))
            .header("authorization", format!("Bearer {access_token}"));
        let reply = self.client.send(&call).ok().filter(|r| r.status == 200)?;
        let body = reply.json();
        // The user service answers the profile itself; an enveloped one is unwrapped.
        let profile = body.get("data").filter(|d| d.is_object()).unwrap_or(&body);
        profile.is_object().then(|| profile.clone())
    }

    /// The bytes and type of the picture at `url`.
    pub fn picture(&self, url: &str) -> Option<Reply> {
        let call = Call::get(url).header("accept", "image/*");
        self.client.send(&call).ok().filter(|r| r.status == 200)
    }
}

/// The token reply of the device flow or a refresh, with the cookie it set.
fn tokens_of(reply: &Reply) -> Option<Tokens> {
    let body = reply.json();
    let access_token = body.get("access_token")?.as_str()?.to_owned();
    let cookie = match reply.header("set-cookie").and_then(cookie::from_set_cookie) {
        Some(cookie::Change::Set(value)) => Some(value),
        _ => None,
    };
    Some(Tokens {
        access_token,
        expires_in: body
            .get("expires_in")
            .and_then(Value::as_u64)
            .unwrap_or(300),
        cookie,
    })
}

/// Whether a result is a failure to try again: anything but a success, 400, 401, 403 and 410.
fn retryable(result: &Result<Reply, String>) -> bool {
    match result {
        Err(_) => true,
        Ok(reply) => !matches!(reply.status, 200..=299 | 400 | 401 | 403 | 410),
    }
}

/// The envelope's error code, `ACCOUNT_SUSPENDED`.
fn code_of(reply: &Reply) -> Option<String> {
    let body = reply.json();
    let code = body.get("error")?.get("code")?.as_str()?;
    Some(code.to_owned())
}

/// Which problem a failed result is.
pub(super) fn problem_of(result: &Result<Reply, String>) -> Problem {
    let Ok(reply) = result else {
        return Problem::Offline;
    };
    match (reply.status, code_of(reply).as_deref()) {
        (429, _) => Problem::SlowDown,
        (_, Some("ACCOUNT_SUSPENDED")) => Problem::Suspended,
        (_, Some("DEVICE_LOGIN_DENIED")) => Problem::Denied,
        (410, _) | (_, Some("DEVICE_CODE_EXPIRED")) => Problem::Expired,
        (status, _) if status >= 500 || status == 408 => Problem::Unavailable,
        _ => Problem::Failed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reply(status: u16, code: &str) -> Result<Reply, String> {
        let body = json!({ "error": { "code": code, "message": "m" } });
        Ok(Reply {
            status,
            body: body.to_string().into_bytes(),
            ..Reply::default()
        })
    }

    #[test]
    fn each_failure_is_its_problem() {
        assert_eq!(problem_of(&Err("refused".into())), Problem::Offline);
        assert_eq!(problem_of(&reply(429, "RATE_LIMITED")), Problem::SlowDown);
        assert_eq!(
            problem_of(&reply(403, "ACCOUNT_SUSPENDED")),
            Problem::Suspended
        );
        assert_eq!(
            problem_of(&reply(403, "DEVICE_LOGIN_DENIED")),
            Problem::Denied
        );
        assert_eq!(
            problem_of(&reply(410, "DEVICE_CODE_EXPIRED")),
            Problem::Expired
        );
        assert_eq!(
            problem_of(&reply(503, "KEYCLOAK_UNAVAILABLE")),
            Problem::Unavailable
        );
        assert_eq!(problem_of(&reply(401, "AUTH_FAILED")), Problem::Failed);
        assert!(retryable(&reply(503, "X")) && retryable(&reply(429, "X")));
        assert!(!retryable(&reply(401, "X")) && !retryable(&reply(410, "X")));
    }
}
