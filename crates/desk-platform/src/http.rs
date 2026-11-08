//! One platform call over desk-sys's fetch: the bearer token, JSON in and out, no Origin header (this
//! is not a browser session), a deadline, one refresh-and-retry after a 401, and the envelopes the
//! services wrap their answers in taken off.

use std::collections::BTreeMap;
use std::time::Duration;

use desk_sys::net::{Method, Request, fetch};
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::Platform;
use crate::error::{ErrorKind, PlatformError, Result};

/// A path segment or query value, percent-encoded but for RFC 3986's unreserved characters.
pub(crate) fn encode(text: &str) -> String {
    text.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                char::from(b).to_string()
            }
            other => format!("%{other:02X}"),
        })
        .collect()
}

/// `path` with the query pairs that have a value.
pub(crate) fn with_query(path: &str, pairs: &[(&str, Option<String>)]) -> String {
    let query: Vec<String> = pairs
        .iter()
        .filter_map(|(key, value)| value.as_ref().map(|v| format!("{key}={}", encode(v))))
        .collect();
    if query.is_empty() {
        path.to_owned()
    } else {
        format!("{path}?{}", query.join("&"))
    }
}

/// The answer's data: the body itself, or what `{ data, meta }` and `{ success: true, data }` hold.
fn unwrap(body: Value) -> Result<Value> {
    let Value::Object(mut map) = body else {
        return Ok(body);
    };
    if map.get("success") == Some(&Value::Bool(false)) {
        return Err(PlatformError::new(
            ErrorKind::Failed,
            "endue AI said the call did not succeed",
        ));
    }
    let wrapped = map.contains_key("meta") || map.contains_key("success") || map.len() == 1;
    match map.remove("data") {
        Some(data) if wrapped => Ok(data),
        Some(data) => {
            map.insert("data".to_owned(), data);
            Ok(Value::Object(map))
        }
        None => Ok(Value::Object(map)),
    }
}

impl Platform {
    /// Call `path` and read its data as `T`; `what` names it in errors.
    pub(crate) fn read<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        body: Option<&Value>,
        what: &str,
    ) -> Result<T> {
        self.read_within(method, path, body, what, self.timeout)
    }

    pub(crate) fn read_within<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        body: Option<&Value>,
        what: &str,
        timeout: Duration,
    ) -> Result<T> {
        let bytes = self.call(method, path, body, timeout)?;
        let value = if bytes.iter().all(u8::is_ascii_whitespace) {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).map_err(|e| PlatformError::unexpected(what, e))?
        };
        serde_json::from_value(unwrap(value)?).map_err(|e| PlatformError::unexpected(what, e))
    }

    /// Call `path` for its status alone (204 and the like).
    pub(crate) fn send(&self, method: Method, path: &str, body: Option<&Value>) -> Result<()> {
        self.call(method, path, body, self.timeout).map(drop)
    }

    /// The 2xx body of one call, after one refresh-and-retry when the token is refused.
    fn call(
        &self,
        method: Method,
        path: &str,
        body: Option<&Value>,
        timeout: Duration,
    ) -> Result<Vec<u8>> {
        let token = self.tokens.token().ok_or_else(PlatformError::signed_out)?;
        let (mut status, mut bytes) = self.once(method, path, body, &token, timeout)?;
        if status == 401 {
            let fresh = self.tokens.refresh(&token).filter(|t| *t != token);
            let Some(fresh) = fresh else {
                return Err(PlatformError::from_response(status, &bytes));
            };
            (status, bytes) = self.once(method, path, body, &fresh, timeout)?;
        }
        if (200..300).contains(&status) {
            Ok(bytes)
        } else {
            Err(PlatformError::from_response(status, &bytes))
        }
    }

    fn once(
        &self,
        method: Method,
        path: &str,
        body: Option<&Value>,
        token: &str,
        timeout: Duration,
    ) -> Result<(u16, Vec<u8>)> {
        let mut headers = BTreeMap::from([
            ("accept".to_owned(), "application/json".to_owned()),
            ("authorization".to_owned(), format!("Bearer {token}")),
            ("user-agent".to_owned(), "endue-desk".to_owned()),
        ]);
        if body.is_some() {
            headers.insert("content-type".to_owned(), "application/json".to_owned());
        }
        let request = Request {
            url: format!("{}{path}", self.base),
            method,
            headers,
            body: body.map(|b| b.to_string().into_bytes()),
            timeout: Some(timeout),
            allowed_hosts: vec![self.host.clone()],
        };
        let response = fetch(&request).map_err(|e| {
            use desk_sys::ErrorCode as Code;
            match e.code {
                Code::Timeout => PlatformError::new(
                    ErrorKind::Offline,
                    format!("endue AI did not answer within {} s", timeout.as_secs()),
                ),
                Code::IoError | Code::NotFound => PlatformError::new(
                    ErrorKind::Offline,
                    format!("endue AI could not be reached: {}", e.message),
                ),
                _ => PlatformError::new(ErrorKind::Failed, e.message),
            }
        })?;
        Ok((response.status, response.body))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn envelopes_come_off_and_bare_bodies_stay() {
        let data = json!({ "visibility": "private" });
        assert_eq!(unwrap(json!({ "data": data, "meta": {} })).unwrap(), data);
        assert_eq!(
            unwrap(json!({ "success": true, "data": [1] })).unwrap(),
            json!([1])
        );
        let bare = json!({ "id": "ag_1", "data": "kept" , "slug": "a" });
        assert_eq!(unwrap(bare.clone()).unwrap(), bare);
        assert!(unwrap(json!({ "success": false, "data": null })).is_err());
    }

    #[test]
    fn queries_are_encoded_and_absent_values_left_out() {
        let path = with_query("/a", &[("q", Some("메일 a&b".to_owned())), ("x", None)]);
        assert_eq!(path, "/a?q=%EB%A9%94%EC%9D%BC%20a%26b");
        assert_eq!(encode("../x"), "..%2Fx");
    }
}
