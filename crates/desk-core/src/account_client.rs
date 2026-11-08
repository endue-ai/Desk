//! How the account (account.rs) reaches the endue AI platform: JSON calls over desk-sys's HTTPS
//! fetch, which connects only to the host each call names. Requests from Rust carry no `Origin`
//! header, which is how the platform's gateway tells a native client from a browser (refs:
//! gw/src/routes/api/v1/auth/index.ts), and the session cookie travels as a plain `Cookie` header.

use std::collections::BTreeMap;
use std::time::Duration;

use desk_sys::net::{Method, Request, fetch};
use serde_json::Value;

/// GET or POST: all the platform's auth endpoints need.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verb {
    Get,
    Post,
}

/// One call: where, with which headers, and the JSON body of a POST.
#[derive(Debug, Clone)]
pub struct Call {
    pub verb: Verb,
    pub url: String,
    /// Lowercase names, sent as they are (`cookie`, `authorization`, `accept`).
    pub headers: Vec<(String, String)>,
    pub json: Option<Value>,
}

impl Call {
    pub fn get(url: impl Into<String>) -> Self {
        Self {
            verb: Verb::Get,
            url: url.into(),
            headers: vec![("accept".to_owned(), "application/json".to_owned())],
            json: None,
        }
    }

    pub fn post(url: impl Into<String>, json: Value) -> Self {
        Self {
            verb: Verb::Post,
            json: Some(json),
            ..Self::get(url)
        }
    }

    pub fn header(mut self, name: &str, value: impl Into<String>) -> Self {
        self.headers.push((name.to_owned(), value.into()));
        self
    }
}

/// What came back: any status is a reply, not an error.
#[derive(Debug, Clone, Default)]
pub struct Reply {
    pub status: u16,
    /// Lowercase names; repeated headers are joined with ", ".
    pub headers: BTreeMap<String, String>,
    pub body: Vec<u8>,
}

impl Reply {
    /// The body as JSON, `null` when it is not JSON.
    pub fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).map(String::as_str)
    }
}

/// The platform as the account calls it.
pub trait IdClient: Send + Sync {
    /// Make `call`. `Err` says why the platform could not be reached.
    fn send(&self, call: &Call) -> Result<Reply, String>;
}

/// The platform over the network.
#[derive(Debug, Clone, Default)]
pub struct NetIdClient;

impl IdClient for NetIdClient {
    fn send(&self, call: &Call) -> Result<Reply, String> {
        let mut headers: BTreeMap<String, String> = call.headers.iter().cloned().collect();
        let body = call.json.as_ref().map(|json| json.to_string().into_bytes());
        if body.is_some() {
            headers.insert("content-type".to_owned(), "application/json".to_owned());
        }
        let request = Request {
            url: call.url.clone(),
            method: match call.verb {
                Verb::Get => Method::Get,
                Verb::Post => Method::Post,
            },
            headers,
            body,
            timeout: Some(Duration::from_secs(20)),
            allowed_hosts: vec![host_of(&call.url).to_owned()],
        };
        let response = fetch(&request).map_err(|e| e.message)?;
        Ok(Reply {
            status: response.status,
            headers: response.headers,
            body: response.body,
        })
    }
}

/// The host of an http(s) URL, without its port.
pub(crate) fn host_of(url: &str) -> &str {
    let authority = authority_of(url);
    let authority = authority
        .rsplit_once('@')
        .map_or(authority, |(_, host)| host);
    authority.split(':').next().unwrap_or(authority)
}

/// `scheme://host:port` of a URL, lowercase, or `None` when it is not http(s).
pub(crate) fn origin_of(url: &str) -> Option<String> {
    let (scheme, _) = url.split_once("://")?;
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "https" && scheme != "http" {
        return None;
    }
    let authority = authority_of(url);
    let authority = authority
        .rsplit_once('@')
        .map_or(authority, |(_, host)| host);
    (!authority.is_empty()).then(|| format!("{scheme}://{}", authority.to_ascii_lowercase()))
}

fn authority_of(url: &str) -> &str {
    let rest = url.split_once("://").map_or(url, |(_, rest)| rest);
    rest.split(['/', '?', '#']).next().unwrap_or(rest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_host_is_the_one_the_url_names() {
        assert_eq!(
            host_of("https://platform.endue.ai/api/v1/auth/refresh"),
            "platform.endue.ai"
        );
        assert_eq!(host_of("http://127.0.0.1:8788/api"), "127.0.0.1");
        assert_eq!(host_of("https://auth.endue.ai"), "auth.endue.ai");
    }

    #[test]
    fn an_origin_is_scheme_host_and_port() {
        let origin = origin_of("https://Auth.Endue.ai/realms/endue/device?user_code=A");
        assert_eq!(origin.as_deref(), Some("https://auth.endue.ai"));
        let local = origin_of("http://127.0.0.1:8181/realms/endue");
        assert_eq!(local.as_deref(), Some("http://127.0.0.1:8181"));
        assert_eq!(origin_of("javascript:alert(1)"), None);
        assert_eq!(origin_of("https:///nothing"), None);
    }
}
