//! The http connector binding without the core (specs/connector/v0 `HttpBinding`, ADR 0106): one
//! sync's requests and their pages, and every record mapped into an item. The core hands in the fetch
//! (desk-sys `net::fetch` after its permission check) and the token; nothing here keeps either, and
//! no message carries the token or a header.

use std::collections::BTreeMap;
use std::time::Duration;

use desk_bridge::{
    HttpBinding, HttpItemMap, HttpPageNext, HttpRead, HttpRequest, HttpValue, Item, ItemSource,
};
use desk_sys::net::{Method, Request, Response};
use serde_json::{Map, Value};

/// Pages a request reads when it names no maxPages, and the most it may name.
const PAGES: u64 = 10;
const MAX_PAGES: u64 = 50;
/// For each request, redirects included.
pub(crate) const TIMEOUT: Duration = Duration::from_secs(30);

/// Why a sync failed: one sentence for the person, and whether signing in again would fix it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Failure {
    pub(crate) message: String,
    pub(crate) reauth: bool,
}

impl Failure {
    pub(crate) fn new(message: String) -> Self {
        Self {
            message,
            reauth: false,
        }
    }
}

/// What a sync brought: its items by id, and how many records made no valid item.
#[derive(Debug, Default)]
pub(crate) struct Synced {
    pub(crate) items: BTreeMap<String, Item>,
    pub(crate) skipped: usize,
}

/// Run every request of `binding` from `base` (the instance's base URL) and map what the pages hold.
/// `token` goes in the auth header of every request; `fetch` makes one request.
pub(crate) fn sync(
    binding: &HttpBinding,
    base: &str,
    token: Option<&str>,
    source: &ItemSource,
    fetch: &mut dyn FnMut(Request) -> Result<Response, Failure>,
) -> Result<Synced, Failure> {
    let origin = origin_of(base).ok_or_else(|| Failure::new(format!("{base} is not a URL")))?;
    let headers = headers(binding, token);
    let mut synced = Synced::default();
    for request in &binding.requests {
        let map = binding
            .maps
            .get(&request.map)
            .ok_or_else(|| Failure::new(format!("the http block has no map {}", request.map)))?;
        let mut url = Some(first_url(base, request));
        let pages = request.max_pages.unwrap_or(PAGES).clamp(1, MAX_PAGES);
        for _ in 0..pages {
            let Some(here) = url.take() else { break };
            let response = fetch(Request {
                url: here,
                method: Method::Get,
                headers: headers.clone(),
                body: None,
                timeout: Some(TIMEOUT),
                allowed_hosts: Vec::new(),
            })?;
            let body = answer(&origin, &request.path, &response)?;
            let records = pointer(&body, &request.items).and_then(Value::as_array);
            let records = records.ok_or_else(|| {
                let at = &request.items;
                Failure::new(format!(
                    "{origin}{} answered without a list at {at:?}",
                    request.path
                ))
            })?;
            for record in records {
                match item_of(map, record, source) {
                    Some((id, item)) => {
                        synced.items.insert(id, item);
                    }
                    None => synced.skipped += 1,
                }
            }
            url = next_url(request, &response, &body).and_then(|next| same_origin(&origin, &next));
        }
    }
    Ok(synced)
}

/// The record's item, keyed by its id, or none when it does not fit specs/item/v0.
pub(crate) fn item_of(
    map: &HttpItemMap,
    record: &Value,
    source: &ItemSource,
) -> Option<(String, Item)> {
    let mut item = Map::new();
    for (field, value) in &map.fields {
        if let Some(found) = read(record, value) {
            item.insert(field.clone(), found);
        }
    }
    item.insert("kind".into(), serde_json::to_value(map.kind).ok()?);
    item.insert("source".into(), serde_json::to_value(source).ok()?);
    let id = item.get("id")?.as_str()?.to_owned();
    let item = serde_json::from_value::<Item>(Value::Object(item)).ok()?;
    Some((id, item))
}

/// One field's value from the record: none for null or missing, unless a default gives one.
fn read(record: &Value, value: &HttpValue) -> Option<Value> {
    match value {
        HttpValue::JsonPointer(at) => pointer(record, at).filter(|v| !v.is_null()).cloned(),
        HttpValue::HttpConst(constant) => Some(constant.r#const.clone()),
        HttpValue::HttpRead(rule) => shaped(record, rule).or_else(|| rule.default.clone()),
    }
}

fn shaped(record: &Value, rule: &HttpRead) -> Option<Value> {
    let mut found = pointer(record, &rule.pointer)
        .filter(|v| !v.is_null())?
        .clone();
    if let Some(after) = &rule.after {
        let text = found.as_str()?;
        let cut = text.rfind(after.as_str())?;
        found = Value::String(text[cut + after.len()..].to_owned());
    }
    if let Some(values) = &rule.values {
        let key = match &found {
            Value::String(text) => text.clone(),
            other => other.to_string(),
        };
        found = values.get(&key)?.clone();
    }
    Some(found)
}

/// RFC 6901: the value at `at` in `value`; the empty pointer is the value itself.
fn pointer<'a>(value: &'a Value, at: &str) -> Option<&'a Value> {
    if at.is_empty() {
        return Some(value);
    }
    value.pointer(at)
}

fn headers(binding: &HttpBinding, token: Option<&str>) -> BTreeMap<String, String> {
    let mut headers = binding.headers.clone().unwrap_or_default();
    if !headers
        .keys()
        .any(|name| name.eq_ignore_ascii_case("user-agent"))
    {
        headers.insert("User-Agent".into(), "endue-Desk".into());
    }
    if let (Some(auth), Some(token)) = (&binding.auth, token) {
        let name = auth
            .header
            .clone()
            .unwrap_or_else(|| "Authorization".into());
        let prefix = auth.prefix.as_deref().unwrap_or("Bearer ");
        headers.insert(name, format!("{prefix}{token}"));
    }
    headers
}

/// The base URL, the request's path and its query, encoded.
fn first_url(base: &str, request: &HttpRequest) -> String {
    let mut url = format!("{base}{}", request.path);
    let query = request.query.iter().flatten();
    let pairs: Vec<String> = query
        .map(|(name, value)| format!("{}={}", encode(name), encode(value)))
        .collect();
    if !pairs.is_empty() {
        url.push('?');
        url.push_str(&pairs.join("&"));
    }
    url
}

/// The response's JSON, or why the sync stops: a status that is no success, a body that is not JSON.
fn answer(origin: &str, path: &str, response: &Response) -> Result<Value, Failure> {
    let status = response.status;
    let header = |name: &str| response.headers.get(name).map(String::as_str);
    let limited = status == 429 || (status == 403 && header("x-ratelimit-remaining") == Some("0"));
    if limited {
        let why = format!("{origin} limited requests ({status}); the next sync tries again");
        return Err(Failure::new(why));
    }
    if status == 401 || status == 403 {
        let message = format!(
            "{origin} refused the token ({status}): connect again with a token that can read this"
        );
        return Err(Failure {
            message,
            reauth: true,
        });
    }
    if !(200..300).contains(&status) {
        return Err(Failure::new(format!("{origin}{path} answered {status}")));
    }
    serde_json::from_slice(&response.body).map_err(|e| {
        Failure::new(format!(
            "{origin}{path} answered with text that is not JSON: {e}"
        ))
    })
}

/// Where the next page is, as the request's pagination says: the Link header's rel="next" (RFC 8288)
/// or a URL in the body.
fn next_url(request: &HttpRequest, response: &Response, body: &Value) -> Option<String> {
    let pagination = request.pagination.as_ref()?;
    match pagination.next {
        HttpPageNext::Link => next_link(response.headers.get("link")?),
        HttpPageNext::Body => {
            let at = pagination.pointer.as_deref().unwrap_or_default();
            pointer(body, at)?.as_str().map(str::to_owned)
        }
    }
}

/// The URL of the link whose rel is next in a Link header.
pub(crate) fn next_link(header: &str) -> Option<String> {
    let mut rest = header;
    while let Some(open) = rest.find('<') {
        let close = open + rest[open..].find('>')?;
        let url = &rest[open + 1..close];
        let after = &rest[close + 1..];
        let end = after.find('<').unwrap_or(after.len());
        let next = after[..end].split(';').any(|param| {
            let param = param.trim().trim_end_matches(',').trim();
            let rel = param.strip_prefix("rel=").map(|r| r.trim_matches('"'));
            rel.is_some_and(|rel| {
                rel.split_whitespace()
                    .any(|r| r.eq_ignore_ascii_case("next"))
            })
        });
        if next {
            return Some(url.to_owned());
        }
        rest = &after[end..];
    }
    None
}

/// `next` when it is on `origin` (a path is joined to it); none for any other origin.
fn same_origin(origin: &str, next: &str) -> Option<String> {
    if next.starts_with('/') {
        return Some(format!("{origin}{next}"));
    }
    let on = next == origin || next.starts_with(&format!("{origin}/")) || {
        let rest = next.strip_prefix(origin).unwrap_or("x");
        rest.starts_with('?')
    };
    on.then(|| next.to_owned())
}

/// scheme://host[:port] of a URL, lowercase.
pub(crate) fn origin_of(url: &str) -> Option<String> {
    let (scheme, rest) = url.split_once("://")?;
    let authority = rest.split(['/', '?', '#']).next()?;
    (!authority.is_empty()).then(|| format!("{}://{}", scheme, authority).to_ascii_lowercase())
}

/// The host and port a URL names, as a net:fetch host pattern (`api.github.com`, `127.0.0.1:8080`).
pub(crate) fn host_of(url: &str) -> Option<String> {
    let origin = origin_of(url)?;
    let authority = origin.split_once("://")?.1;
    Some(
        authority
            .rsplit_once('@')
            .map_or(authority, |(_, h)| h)
            .to_owned(),
    )
}

/// RFC 3986 percent-encoding of everything but the unreserved characters.
fn encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_link_header_names_its_next_page() {
        let header = r#"<https://api.example.com/x?page=2>; rel="next", <https://api.example.com/x?page=5>; rel="last""#;
        assert_eq!(
            next_link(header).as_deref(),
            Some("https://api.example.com/x?page=2")
        );
        assert_eq!(next_link(r#"<https://a.example/p>; rel="prev""#), None);
    }

    #[test]
    fn a_next_page_stays_on_the_base_origin() {
        let origin = "https://api.example.com";
        assert!(same_origin(origin, "https://api.example.com/x?page=2").is_some());
        assert_eq!(
            same_origin(origin, "/x?page=3").as_deref(),
            Some("https://api.example.com/x?page=3")
        );
        assert_eq!(
            same_origin(origin, "https://api.example.com.evil.test/x"),
            None
        );
        assert_eq!(same_origin(origin, "https://other.example/x"), None);
        assert_eq!(
            host_of("http://127.0.0.1:8080/api").as_deref(),
            Some("127.0.0.1:8080")
        );
        assert_eq!(encode("is:open @me"), "is%3Aopen%20%40me");
    }
}
