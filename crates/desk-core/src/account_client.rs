//! How the account (account.rs) reaches endue ID: form posts that answer JSON, over desk-sys's
//! HTTPS fetch, which connects only to endue ID's own host.

use std::collections::BTreeMap;
use std::time::Duration;

use desk_sys::net::{Method, Request, fetch};
use serde_json::Value;

/// One endpoint call of endue ID.
pub trait IdClient: Send + Sync {
    /// POST `form` as `application/x-www-form-urlencoded` to `url`: the status and the JSON body
    /// (`null` when the body is not JSON). `Err` when endue ID could not be reached.
    fn post_form(&self, url: &str, form: &[(&str, &str)]) -> Result<(u16, Value), String>;
}

/// endue ID over the network.
#[derive(Debug, Clone, Default)]
pub struct NetIdClient;

impl IdClient for NetIdClient {
    fn post_form(&self, url: &str, form: &[(&str, &str)]) -> Result<(u16, Value), String> {
        let headers = BTreeMap::from([
            (
                "content-type".to_owned(),
                "application/x-www-form-urlencoded".to_owned(),
            ),
            ("accept".to_owned(), "application/json".to_owned()),
        ]);
        let request = Request {
            url: url.to_owned(),
            method: Method::Post,
            headers,
            body: Some(encode(form).into_bytes()),
            timeout: Some(Duration::from_secs(30)),
            allowed_hosts: vec![host_of(url).to_owned()],
        };
        let response = fetch(&request).map_err(|e| e.message)?;
        let body = serde_json::from_slice(&response.body).unwrap_or(Value::Null);
        Ok((response.status, body))
    }
}

/// `form` as `application/x-www-form-urlencoded`.
pub(crate) fn encode(form: &[(&str, &str)]) -> String {
    form.iter()
        .map(|(key, value)| format!("{}={}", escape(key), escape(value)))
        .collect::<Vec<_>>()
        .join("&")
}

fn escape(text: &str) -> String {
    text.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                char::from(b).to_string()
            }
            b' ' => "+".to_owned(),
            other => format!("%{other:02X}"),
        })
        .collect()
}

/// The host of an http(s) URL, without its port.
fn host_of(url: &str) -> &str {
    let rest = url.split_once("://").map_or(url, |(_, rest)| rest);
    let authority = rest.split(['/', '?', '#']).next().unwrap_or(rest);
    let authority = authority
        .rsplit_once('@')
        .map_or(authority, |(_, host)| host);
    authority.split(':').next().unwrap_or(authority)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forms_are_percent_encoded() {
        let form = [
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ("scope", "brain mail"),
        ];
        assert_eq!(
            encode(&form),
            "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code&scope=brain+mail"
        );
    }

    #[test]
    fn the_host_is_the_one_endue_id_names() {
        assert_eq!(host_of("https://id.endue.ai/oauth/token"), "id.endue.ai");
        assert_eq!(host_of("http://127.0.0.1:8788/oauth/token"), "127.0.0.1");
        assert_eq!(host_of("https://id.endue.ai"), "id.endue.ai");
    }
}
