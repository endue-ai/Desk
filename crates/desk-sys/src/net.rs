//! Network primitives: one HTTP(S) request over rustls, its whole response returned, and live
//! connections (`ws`, `sse`). desk-core checks the grant; here every URL of a call, the first and each
//! redirect, must match `allowed_hosts` before anything connects to it. Each connection goes the way
//! `proxy` chooses: the environment's proxy, the system's PAC file or manual proxy, or direct.

use std::collections::BTreeMap;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use ureq::http;
use ureq::tls::{RootCerts, TlsConfig};
use url::Url;

use crate::{Error, ErrorCode};

mod hosts;
pub mod proxy;
pub mod sse;
mod tunnel;
pub mod ws;
pub use hosts::host_allowed;

/// Redirects followed before the call fails.
pub const MAX_REDIRECTS: usize = 10;
/// The largest response body read; a larger one fails with `io_error`.
pub const MAX_BODY_BYTES: u64 = 64 * 1024 * 1024;

/// The HTTP methods of the bridge.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub enum Method {
    #[default]
    Get,
    Head,
    Post,
    Put,
    Patch,
    Delete,
    Options,
}

/// One request.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Request {
    /// An http or https URL.
    pub url: String,
    pub method: Method,
    pub headers: BTreeMap<String, String>,
    pub body: Option<Vec<u8>>,
    /// For the whole call, redirects included. None waits as long as the server takes.
    pub timeout: Option<Duration>,
    /// Host patterns (bridge `HostPattern`) that every URL of the call must match.
    pub allowed_hosts: Vec<String>,
}

/// The final response. Any status is a response, not an error.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Response {
    pub status: u16,
    /// Lowercase names; repeated headers are joined with ", ".
    pub headers: BTreeMap<String, String>,
    pub body: Vec<u8>,
}

/// Make the request and follow redirects (at most `MAX_REDIRECTS`). A URL whose host is outside
/// `allowed_hosts` fails with `permission_denied` before it is connected to. 301 and 302 turn a POST
/// into a GET without a body, 303 does that for every method but HEAD, and 307 and 308 keep both.
/// `Authorization`, `Cookie` and `Proxy-Authorization` are dropped when a redirect leaves the origin.
pub fn fetch(request: &Request) -> Result<Response, Error> {
    let deadline = request.timeout.map(|timeout| Instant::now() + timeout);
    let mut url = parse(&request.url)?;
    let mut method = request.method;
    let mut headers = request.headers.clone();
    let mut body = request.body.clone();
    for _ in 0..=MAX_REDIRECTS {
        hosts::check(&request.allowed_hosts, &url, &request.url)?;
        let left = left(deadline, &request.url)?;
        let response = send(&url, method, &headers, body.as_deref(), left)?;
        let Some(next) = redirect(&url, &response)? else {
            return Ok(response);
        };
        let to_get = match response.status {
            303 => method != Method::Head,
            301 | 302 => method == Method::Post,
            _ => false,
        };
        if to_get {
            method = Method::Get;
            body = None;
            headers.retain(|name, _| !is_one_of(name, &["content-type", "content-length"]));
        }
        redirect_headers(&mut headers, &url, &next);
        url = next;
    }
    Err(Error::new(
        ErrorCode::IoError,
        format!("{}: more than {MAX_REDIRECTS} redirects", request.url),
    ))
}

fn parse(text: &str) -> Result<Url, Error> {
    parse_as(text, &["http", "https"], "fetched")
}

/// `text` as a URL with a host and one of `schemes`, without its fragment; `invalid_params` if not.
fn parse_as(text: &str, schemes: &[&str], verb: &str) -> Result<Url, Error> {
    let invalid = |why: String| Error::new(ErrorCode::InvalidParams, format!("{text:?}: {why}"));
    let mut url = Url::parse(text).map_err(|err| invalid(err.to_string()))?;
    if !schemes.contains(&url.scheme()) {
        return Err(invalid(format!(
            "only {} URLs can be {verb}",
            schemes.join(" and ")
        )));
    }
    if url.host_str().is_none_or(str::is_empty) {
        return Err(invalid("no host".to_owned()));
    }
    url.set_fragment(None);
    Ok(url)
}

/// Where a redirect response points, if it is one.
fn redirect(from: &Url, response: &Response) -> Result<Option<Url>, Error> {
    if !matches!(response.status, 301 | 302 | 303 | 307 | 308) {
        return Ok(None);
    }
    let Some(location) = response.headers.get("location") else {
        return Ok(None);
    };
    follow(from, location, parse).map(Some)
}

/// The URL a redirect's `location` names, checked by `parse`; `io_error` if it is not one.
fn follow(
    from: &Url,
    location: &str,
    parse: impl Fn(&str) -> Result<Url, Error>,
) -> Result<Url, Error> {
    let next = from.join(location).map_err(|err| {
        Error::new(
            ErrorCode::IoError,
            format!("{from}: bad redirect to {location:?}: {err}"),
        )
    })?;
    parse(next.as_str()).map_err(|err| Error::new(ErrorCode::IoError, err.message))
}

/// What is left of the call's time, or `timeout` once it is gone. None waits as long as it takes.
fn left(deadline: Option<Instant>, requested: &str) -> Result<Option<Duration>, Error> {
    match deadline {
        Some(deadline) => match deadline.checked_duration_since(Instant::now()) {
            Some(left) if !left.is_zero() => Ok(Some(left)),
            _ => Err(timed_out(requested)),
        },
        None => Ok(None),
    }
}

/// Headers sent along to the next URL: no credentials when it is another origin.
fn redirect_headers(headers: &mut BTreeMap<String, String>, from: &Url, to: &Url) {
    if to.origin() != from.origin() {
        headers.retain(|name, _| {
            !is_one_of(name, &["authorization", "cookie", "proxy-authorization"])
        });
    }
}

fn send(
    url: &Url,
    method: Method,
    headers: &BTreeMap<String, String>,
    body: Option<&[u8]>,
    timeout: Option<Duration>,
) -> Result<Response, Error> {
    let mut builder = http::Request::builder()
        .method(method.as_http())
        .uri(url.as_str());
    for (name, value) in headers {
        let invalid = || Error::new(ErrorCode::InvalidParams, format!("bad header {name:?}"));
        let name = http::HeaderName::from_bytes(name.as_bytes()).map_err(|_| invalid())?;
        let value = http::HeaderValue::from_str(value).map_err(|_| invalid())?;
        builder = builder.header(name, value);
    }
    let invalid = |err: http::Error| Error::new(ErrorCode::InvalidParams, format!("{url}: {err}"));
    let agent = agent();
    let proxy = ureq_proxy(url)?;
    let result = match body {
        Some(body) => {
            let request = builder.body(body).map_err(invalid)?;
            agent.run(
                agent
                    .configure_request(request)
                    .timeout_global(timeout)
                    .proxy(proxy)
                    .build(),
            )
        }
        None => {
            let request = builder.body(()).map_err(invalid)?;
            agent.run(
                agent
                    .configure_request(request)
                    .timeout_global(timeout)
                    .proxy(proxy)
                    .build(),
            )
        }
    };
    let mut response = result.map_err(|err| call_error(url, &err))?;
    let mut collected: BTreeMap<String, String> = BTreeMap::new();
    for (name, value) in response.headers() {
        let value = String::from_utf8_lossy(value.as_bytes());
        collected
            .entry(name.as_str().to_owned())
            .and_modify(|joined| {
                joined.push_str(", ");
                joined.push_str(&value);
            })
            .or_insert_with(|| value.into_owned());
    }
    let body = response
        .body_mut()
        .with_config()
        .limit(MAX_BODY_BYTES)
        .read_to_vec()
        .map_err(|err| call_error(url, &err))?;
    Ok(Response {
        status: response.status().as_u16(),
        headers: collected,
        body,
    })
}

/// One agent for every call, so connections are pooled (per proxy). Redirects are followed by
/// `fetch`, which checks each host first, and statuses are never errors. Certificates are checked
/// against the OS trust store; each request names its proxy (`ureq_proxy`).
fn agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| agent_config().build().into())
}

fn agent_config() -> ureq::config::ConfigBuilder<ureq::typestate::AgentScope> {
    ureq::Agent::config_builder()
        .max_redirects(0)
        .http_status_as_error(false)
        .proxy(None)
        .tls_config(
            TlsConfig::builder()
                .root_certs(RootCerts::PlatformVerifier)
                .build(),
        )
}

/// The proxy `proxy::resolver()` chooses for `url`, as ureq takes it.
fn ureq_proxy(url: &Url) -> Result<Option<ureq::Proxy>, Error> {
    match proxy::resolver().route(url.as_str()) {
        proxy::Route::Direct => Ok(None),
        proxy::Route::Proxy(proxy) => ureq::Proxy::new(&proxy).map(Some).map_err(|err| {
            Error::new(
                ErrorCode::IoError,
                format!("{url}: the proxy {}: {err}", proxy::shown(&proxy)),
            )
        }),
    }
}

fn call_error(url: &Url, err: &ureq::Error) -> Error {
    let code = match err {
        ureq::Error::Timeout(_) => ErrorCode::Timeout,
        ureq::Error::Io(io) if io.kind() == std::io::ErrorKind::TimedOut => ErrorCode::Timeout,
        ureq::Error::BadUri(_) | ureq::Error::Http(_) => ErrorCode::InvalidParams,
        _ => ErrorCode::IoError,
    };
    Error::new(code, format!("{url}: {err}"))
}

fn timed_out(url: &str) -> Error {
    Error::new(ErrorCode::Timeout, format!("{url}: timed out"))
}

fn is_one_of(name: &str, names: &[&str]) -> bool {
    names.iter().any(|n| name.eq_ignore_ascii_case(n))
}

impl Method {
    fn as_http(self) -> http::Method {
        match self {
            Method::Get => http::Method::GET,
            Method::Head => http::Method::HEAD,
            Method::Post => http::Method::POST,
            Method::Put => http::Method::PUT,
            Method::Patch => http::Method::PATCH,
            Method::Delete => http::Method::DELETE,
            Method::Options => http::Method::OPTIONS,
        }
    }
}
