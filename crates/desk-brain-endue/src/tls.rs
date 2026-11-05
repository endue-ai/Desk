//! https brains, endue AI among them: the same requests as `http::send`, over rustls with the
//! system's trusted roots (the platform verifier). ureq carries them; its body reader feeds the
//! same JSON and Server-Sent Events readers as plain http.

use std::io::{self, BufReader};
use std::sync::OnceLock;
use std::time::Duration;

use serde_json::Value;
use ureq::http;
use ureq::tls::{RootCerts, TlsConfig};

use crate::http::{Endpoint, Response};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// How long the brain may take to start answering; a turn's stream then runs as long as it lasts.
const ANSWER_TIMEOUT: Duration = Duration::from_secs(60);

fn agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| {
        ureq::Agent::config_builder()
            .http_status_as_error(false)
            .max_redirects(0)
            .timeout_connect(Some(CONNECT_TIMEOUT))
            .timeout_recv_response(Some(ANSWER_TIMEOUT))
            .user_agent("endue-desk")
            .tls_config(
                TlsConfig::builder()
                    .root_certs(RootCerts::PlatformVerifier)
                    .build(),
            )
            .build()
            .into()
    })
}

/// Send one request to an https endpoint.
pub(crate) fn send(
    endpoint: &Endpoint,
    token: Option<&str>,
    method: &str,
    path: &str,
    body: Option<&Value>,
) -> io::Result<Response> {
    let mut builder = http::Request::builder()
        .method(method)
        .uri(format!("{}{path}", endpoint.url()))
        .header("accept", "application/json, text/event-stream");
    if let Some(token) = token {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
    if body.is_some() {
        builder = builder.header("content-type", "application/json");
    }
    let payload = body.map(Value::to_string).unwrap_or_default();
    let request = builder.body(payload).map_err(io::Error::other)?;
    let response = agent().run(request).map_err(|e| match e {
        ureq::Error::Io(io) => io,
        other => io::Error::other(other),
    })?;
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let reader = BufReader::new(response.into_body().into_reader());
    Ok(Response::new(status, content_type, Box::new(reader)))
}
