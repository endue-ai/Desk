//! endue AI client, built only against the public `specs/brain` contract. `HttpBrain` takes the
//! brain's base URL from configuration; until endue AI is connected it points at examples/brain-echo.
pub const NAME: &str = env!("CARGO_PKG_NAME");

pub mod http;

use std::io;

use desk_brain::{
    Brain, BrainError, BrainFailure, CreateSessionRequest, Lease, LeaseAcquireRequest,
    LeaseRenewRequest, Session, ToolResultRequest, TurnEvent, TurnRequest,
};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::http::{Endpoint, Response, send};

/// The brain at a base URL such as `http://127.0.0.1:8787/v0`.
#[derive(Debug, Clone)]
pub struct HttpBrain {
    endpoint: Endpoint,
    token: Option<String>,
}

impl HttpBrain {
    pub fn new(base_url: &str) -> Result<Self, String> {
        Ok(Self {
            endpoint: Endpoint::parse(base_url)?,
            token: None,
        })
    }

    /// Send `token` as a bearer token (an endue ID token for endue AI).
    pub fn with_token(mut self, token: impl Into<String>) -> Self {
        self.token = Some(token.into());
        self
    }

    pub fn base_url(&self) -> String {
        self.endpoint.url()
    }

    fn exchange(
        &self,
        method: &str,
        path: &str,
        body: Option<&Value>,
    ) -> Result<Response, BrainFailure> {
        let response =
            send(&self.endpoint, self.token.as_deref(), method, path, body).map_err(unreachable)?;
        if response.status < 300 {
            return Ok(response);
        }
        let status = response.status;
        let body = response.json().map_err(unreachable)?;
        match serde_json::from_value::<BrainError>(body.clone()) {
            Ok(error) => Err(BrainFailure::Refused { status, error }),
            Err(_) => Err(BrainFailure::Protocol(format!(
                "{method} {path} answered {status} with {body}"
            ))),
        }
    }

    fn call<T: DeserializeOwned>(
        &self,
        method: &str,
        path: &str,
        body: Option<&impl Serialize>,
    ) -> Result<T, BrainFailure> {
        let body = body.map(to_json).transpose()?;
        let value = self
            .exchange(method, path, body.as_ref())?
            .json()
            .map_err(unreachable)?;
        serde_json::from_value(value.clone())
            .map_err(|e| BrainFailure::Protocol(format!("{method} {path}: {e} in {value}")))
    }

    /// POST and read the answer as a turn stream, which must end with turn.completed or turn.error.
    fn stream(
        &self,
        path: &str,
        body: &impl Serialize,
        on_event: &mut dyn FnMut(TurnEvent),
    ) -> Result<(), BrainFailure> {
        let response = self.exchange("POST", path, Some(&to_json(body)?))?;
        if !response.is_event_stream() {
            return Err(BrainFailure::Protocol(format!(
                "POST {path} did not answer with text/event-stream"
            )));
        }
        let mut ended = false;
        for data in response.events() {
            let data = data.map_err(unreachable)?;
            let event: TurnEvent = serde_json::from_str(&data)
                .map_err(|e| BrainFailure::Protocol(format!("{e} in event {data}")))?;
            ended = matches!(event, TurnEvent::TurnCompleted(_) | TurnEvent::TurnError(_));
            on_event(event);
        }
        if ended {
            Ok(())
        } else {
            Err(BrainFailure::Unreachable(
                "the turn stream ended before the turn did".to_owned(),
            ))
        }
    }
}

fn to_json(body: &impl Serialize) -> Result<Value, BrainFailure> {
    serde_json::to_value(body).map_err(|e| BrainFailure::Protocol(e.to_string()))
}

fn unreachable(error: io::Error) -> BrainFailure {
    BrainFailure::Unreachable(error.to_string())
}

fn segment(id: &str) -> String {
    id.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                char::from(b).to_string()
            }
            other => format!("%{other:02X}"),
        })
        .collect()
}

const NO_BODY: Option<&()> = None;

impl Brain for HttpBrain {
    fn create_session(&self, request: &CreateSessionRequest) -> Result<Session, BrainFailure> {
        self.call("POST", "/sessions", Some(request))
    }

    fn get_session(&self, session_id: &str) -> Result<Session, BrainFailure> {
        self.call(
            "GET",
            &format!("/sessions/{}", segment(session_id)),
            NO_BODY,
        )
    }

    fn create_turn(
        &self,
        session_id: &str,
        request: &TurnRequest,
        on_event: &mut dyn FnMut(TurnEvent),
    ) -> Result<(), BrainFailure> {
        let path = format!("/sessions/{}/turns", segment(session_id));
        self.stream(&path, request, on_event)
    }

    fn submit_tool_result(
        &self,
        session_id: &str,
        turn_id: &str,
        request: &ToolResultRequest,
        on_event: &mut dyn FnMut(TurnEvent),
    ) -> Result<(), BrainFailure> {
        let path = format!(
            "/sessions/{}/turns/{}/tool-results",
            segment(session_id),
            segment(turn_id)
        );
        self.stream(&path, request, on_event)
    }

    fn get_lease(&self, session_id: &str) -> Result<Lease, BrainFailure> {
        let path = format!("/sessions/{}/lease", segment(session_id));
        self.call("GET", &path, NO_BODY)
    }

    fn acquire_lease(
        &self,
        session_id: &str,
        request: &LeaseAcquireRequest,
    ) -> Result<Lease, BrainFailure> {
        let path = format!("/sessions/{}/lease", segment(session_id));
        self.call("POST", &path, Some(request))
    }

    fn renew_lease(
        &self,
        session_id: &str,
        lease_id: &str,
        request: &LeaseRenewRequest,
    ) -> Result<Lease, BrainFailure> {
        let path = format!(
            "/sessions/{}/lease/{}",
            segment(session_id),
            segment(lease_id)
        );
        self.call("PUT", &path, Some(request))
    }

    fn release_lease(&self, session_id: &str, lease_id: &str) -> Result<(), BrainFailure> {
        let path = format!(
            "/sessions/{}/lease/{}",
            segment(session_id),
            segment(lease_id)
        );
        self.exchange("DELETE", &path, None)
            .and_then(|response| response.json().map(drop).map_err(unreachable))
    }
}
