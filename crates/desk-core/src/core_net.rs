//! The network side of `Core`: net.fetch. Every hop's host must be inside the scope; a redirect to a
//! host outside it is returned as the result instead of being followed.

use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use base64::Engine as _;
use desk_bridge::{
    BridgeError, Encoding, ErrorCode, HttpMethod, NetFetchParams, NetFetchResult, Permission,
};
use desk_sys::net::{self as sysnet, NetError, Request};
use url::Url;

use crate::handler::{Answer, Core, denied, error, json};
use crate::perm::Target;

/// Redirects followed inside the scope before the last one is returned as it is.
const MAX_REDIRECTS: usize = 10;

impl Core {
    pub(crate) fn net_fetch(&self, caller: &str, params: NetFetchParams) -> Answer {
        let scope = Permission::NetFetch(params.scope);
        let mut url = parse(&params.url)?;
        self.authorize_host(caller, &scope, &url)?;
        let mut method = params.method.unwrap_or(HttpMethod::GET);
        let mut body = match (params.body, params.body_encoding.unwrap_or(Encoding::Utf8)) {
            (None, _) => None,
            (Some(text), Encoding::Utf8) => Some(text.into_bytes()),
            (Some(text), Encoding::Base64) => Some(
                base64::engine::general_purpose::STANDARD
                    .decode(text)
                    .map_err(|e| {
                        error(ErrorCode::InvalidParams, format!("body is not base64: {e}"))
                    })?,
            ),
        };
        // The URL decides the host; a Host header cannot point the request elsewhere.
        let mut headers: Vec<(String, String)> = params
            .headers
            .unwrap_or_default()
            .into_iter()
            .filter(|(name, _)| !name.eq_ignore_ascii_case("host"))
            .collect();
        let deadline = params
            .timeout_ms
            .map(|ms| Instant::now() + Duration::from_millis(ms));
        let mut hops = 0;
        loop {
            let timeout = match deadline {
                Some(at) => match at.checked_duration_since(Instant::now()) {
                    Some(left) if !left.is_zero() => Some(left),
                    _ => return Err(net_error(NetError::Timeout)),
                },
                None => None,
            };
            let response = sysnet::fetch(&Request {
                method: method_name(method).to_owned(),
                url: url.to_string(),
                headers: headers.clone(),
                body: body.clone(),
                timeout,
            })
            .map_err(net_error)?;
            let next = (hops < MAX_REDIRECTS && is_redirect(response.status))
                .then(|| location(&response))
                .flatten()
                .and_then(|location| url.join(&location).ok())
                .filter(|next| matches!(next.scheme(), "http" | "https"))
                .filter(|next| self.authorize_host(caller, &scope, next).is_ok());
            let Some(next) = next else {
                return json(result(response));
            };
            if next.host_str() != url.host_str() {
                headers.retain(|(name, _)| {
                    !name.eq_ignore_ascii_case("authorization")
                        && !name.eq_ignore_ascii_case("cookie")
                });
            }
            let to_get = response.status == 303
                || (matches!(response.status, 301 | 302) && method == HttpMethod::POST);
            if to_get {
                method = HttpMethod::GET;
                body = None;
                headers.retain(|(name, _)| !name.eq_ignore_ascii_case("content-type"));
            }
            url = next;
            hops += 1;
        }
    }

    fn authorize_host(
        &self,
        caller: &str,
        scope: &Permission,
        url: &Url,
    ) -> Result<String, BridgeError> {
        let host = host_of(url)
            .ok_or_else(|| error(ErrorCode::InvalidParams, format!("{url} has no host")))?;
        self.permissions()
            .authorize(caller, scope, &Target::Host(&host))
            .map_err(denied)
    }
}

fn parse(text: &str) -> Result<Url, BridgeError> {
    let url =
        Url::parse(text).map_err(|e| error(ErrorCode::InvalidParams, format!("not a URL: {e}")))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(error(
            ErrorCode::InvalidParams,
            "only http and https URLs can be fetched".to_owned(),
        ));
    }
    Ok(url)
}

/// What scopes name: the host, with the port when it is not the scheme's default.
fn host_of(url: &Url) -> Option<String> {
    let host = url.host_str()?.to_ascii_lowercase();
    Some(match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host,
    })
}

fn is_redirect(status: u16) -> bool {
    matches!(status, 301 | 302 | 303 | 307 | 308)
}

fn location(response: &sysnet::Response) -> Option<String> {
    response
        .headers
        .iter()
        .find(|(name, _)| name == "location")
        .map(|(_, value)| value.clone())
}

fn result(response: sysnet::Response) -> NetFetchResult {
    let mut headers: BTreeMap<String, String> = BTreeMap::new();
    for (name, value) in response.headers {
        headers
            .entry(name)
            .and_modify(|joined| {
                joined.push_str(", ");
                joined.push_str(&value);
            })
            .or_insert(value);
    }
    let (body, body_encoding) = match String::from_utf8(response.body) {
        Ok(text) => (text, Encoding::Utf8),
        Err(e) => (
            base64::engine::general_purpose::STANDARD.encode(e.into_bytes()),
            Encoding::Base64,
        ),
    };
    NetFetchResult {
        status: u64::from(response.status),
        headers,
        body,
        body_encoding,
    }
}

fn method_name(method: HttpMethod) -> &'static str {
    match method {
        HttpMethod::GET => "GET",
        HttpMethod::HEAD => "HEAD",
        HttpMethod::POST => "POST",
        HttpMethod::PUT => "PUT",
        HttpMethod::PATCH => "PATCH",
        HttpMethod::DELETE => "DELETE",
        HttpMethod::OPTIONS => "OPTIONS",
    }
}

fn net_error(e: NetError) -> BridgeError {
    let code = match e {
        NetError::Timeout => ErrorCode::Timeout,
        NetError::InvalidRequest(_) => ErrorCode::InvalidParams,
        NetError::TooLarge | NetError::Failed(_) => ErrorCode::IoError,
    };
    error(code, e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hosts_carry_their_port_only_when_it_is_not_the_default() {
        let host = |text: &str| host_of(&Url::parse(text).unwrap());
        assert_eq!(
            host("https://Example.com/a").as_deref(),
            Some("example.com")
        );
        assert_eq!(
            host("https://example.com:443/").as_deref(),
            Some("example.com")
        );
        assert_eq!(
            host("http://127.0.0.1:8787/v0").as_deref(),
            Some("127.0.0.1:8787")
        );
    }
}
