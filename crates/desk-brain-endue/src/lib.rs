//! endue AI client, built only against the public `specs/brain` contract. `HttpBrain` takes the
//! brain's base URL from configuration (examples/brain-echo in development) and, for endue AI, the
//! person's endue ID token on every request (ADR 0084).
pub const NAME: &str = env!("CARGO_PKG_NAME");

pub mod http;
mod tls;

use std::fmt;
use std::io;
use std::sync::Arc;

use desk_brain::{
    A2ATaskList, AgentCard, AgentList, AgentQuery, Brain, BrainError, BrainFailure,
    CreateSessionRequest, Lease, LeaseAcquireRequest, LeaseRenewRequest, Session, SpaceList,
    TaskQuery, ToolResultRequest, TurnEvent, TurnRequest,
};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::http::{Endpoint, Response, send};

/// Where a request's bearer token comes from, asked again for every request.
pub type TokenSource = Arc<dyn Fn() -> Option<String> + Send + Sync>;

/// The brain at a base URL such as `http://127.0.0.1:8787/v0` or `https://…/v0`.
#[derive(Clone)]
pub struct HttpBrain {
    endpoint: Endpoint,
    token: Option<TokenSource>,
}

impl fmt::Debug for HttpBrain {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("HttpBrain")
            .field("endpoint", &self.endpoint)
            .field("token", &self.token.as_ref().map(|_| "…"))
            .finish()
    }
}

impl HttpBrain {
    pub fn new(base_url: &str) -> Result<Self, String> {
        Ok(Self {
            endpoint: Endpoint::parse(base_url)?,
            token: None,
        })
    }

    /// Send `token` as a bearer token (an endue ID token for endue AI).
    pub fn with_token(self, token: impl Into<String>) -> Self {
        let token = token.into();
        self.with_token_source(Arc::new(move || Some(token.clone())))
    }

    /// Send what `source` answers as the bearer token of each request, none while it answers
    /// `None`: the signed-in endue ID's token, refreshed when it has expired.
    pub fn with_token_source(mut self, source: TokenSource) -> Self {
        self.token = Some(source);
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
        let token = self.token.as_ref().and_then(|source| source());
        let response =
            send(&self.endpoint, token.as_deref(), method, path, body).map_err(unreachable)?;
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

/// A path with a query string. Absent parameters are left out, values are percent-encoded like
/// path segments, and enums are spelled by their contract names (`input_required`).
struct WithQuery {
    path: String,
    separator: char,
}

impl WithQuery {
    fn new(path: &str) -> Self {
        Self {
            path: path.to_owned(),
            separator: '?',
        }
    }

    fn param(mut self, name: &str, value: Option<impl Serialize>) -> Result<Self, BrainFailure> {
        let Some(value) = value else {
            return Ok(self);
        };
        let value = match to_json(&value)? {
            Value::String(text) => text,
            other => other.to_string(),
        };
        self.path.push(self.separator);
        self.path.push_str(&format!("{name}={}", segment(&value)));
        self.separator = '&';
        Ok(self)
    }
}

fn agents_path(query: &AgentQuery) -> Result<String, BrainFailure> {
    Ok(WithQuery::new("/agents")
        .param("spaceId", query.space_id.as_deref())?
        .param("status", query.status)?
        .param("page", query.page)?
        .param("limit", query.limit)?
        .path)
}

fn tasks_path(query: &TaskQuery) -> Result<String, BrainFailure> {
    Ok(WithQuery::new("/a2a/tasks")
        .param("targetAgentId", query.target_agent_id.as_deref())?
        .param("status", query.status)?
        .param("page", query.page)?
        .param("limit", query.limit)?
        .path)
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

    fn list_agents(&self, query: &AgentQuery) -> Result<AgentList, BrainFailure> {
        self.call("GET", &agents_path(query)?, NO_BODY)
    }

    fn get_agent_card(&self, agent_id: &str) -> Result<AgentCard, BrainFailure> {
        let path = format!("/agents/{}/card", segment(agent_id));
        self.call("GET", &path, NO_BODY)
    }

    fn list_spaces(&self) -> Result<SpaceList, BrainFailure> {
        self.call("GET", "/spaces", NO_BODY)
    }

    fn list_a2a_tasks(&self, query: &TaskQuery) -> Result<A2ATaskList, BrainFailure> {
        self.call("GET", &tasks_path(query)?, NO_BODY)
    }
}

#[cfg(test)]
mod tests;
