//! Network primitive: one HTTP(S) request, no redirects followed, the whole body read. No permission
//! checks happen here: desk-core authorizes every hop first.

use std::time::Duration;

/// The largest response body read into memory.
pub const MAX_BODY: u64 = 16 * 1024 * 1024;

#[derive(Debug, Clone, Default)]
pub struct Request {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<Vec<u8>>,
    pub timeout: Option<Duration>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Response {
    pub status: u16,
    /// Header names in lower case; repeated headers in arrival order.
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NetError {
    InvalidRequest(String),
    Timeout,
    TooLarge,
    Failed(String),
}

impl std::fmt::Display for NetError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidRequest(why) => write!(f, "invalid request: {why}"),
            Self::Timeout => f.write_str("the request timed out"),
            Self::TooLarge => write!(f, "the response is larger than {MAX_BODY} bytes"),
            Self::Failed(why) => f.write_str(why),
        }
    }
}

/// Make one request. Every status is a response; redirects are returned, not followed.
pub fn fetch(request: &Request) -> Result<Response, NetError> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .max_redirects(0)
        .http_status_as_error(false)
        .timeout_global(request.timeout)
        .build()
        .into();
    let mut builder = ureq::http::Request::builder()
        .method(request.method.as_str())
        .uri(request.url.as_str());
    for (name, value) in &request.headers {
        builder = builder.header(name.as_str(), value.as_str());
    }
    let built = builder
        .body(request.body.clone().unwrap_or_default())
        .map_err(|e| NetError::InvalidRequest(e.to_string()))?;
    let mut response = agent.run(built).map_err(failure)?;
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .map(|(name, value)| {
            (
                name.as_str().to_owned(),
                String::from_utf8_lossy(value.as_bytes()).into_owned(),
            )
        })
        .collect();
    let body = response
        .body_mut()
        .with_config()
        .limit(MAX_BODY)
        .read_to_vec()
        .map_err(failure)?;
    Ok(Response {
        status,
        headers,
        body,
    })
}

fn failure(error: ureq::Error) -> NetError {
    match error {
        ureq::Error::Timeout(_) => NetError::Timeout,
        ureq::Error::BodyExceedsLimit(_) => NetError::TooLarge,
        ureq::Error::Io(e) if e.kind() == std::io::ErrorKind::TimedOut => NetError::Timeout,
        other => NetError::Failed(other.to_string()),
    }
}
