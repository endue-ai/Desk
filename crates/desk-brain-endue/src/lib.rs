//! endue AI client, built only against the public `specs/brain` contract. `HttpBrain` takes the
//! brain's base URL from configuration; until endue AI is connected it points at examples/brain-echo.
pub const NAME: &str = env!("CARGO_PKG_NAME");

pub mod http;

use std::io;

use desk_brain::{
    AgentList, AgentQuery, Brain, BrainError, BrainErrorCode, BrainFailure, CreateSessionRequest,
    Lease, LeaseAcquireRequest, LeaseRenewRequest, Session, SpaceAgentList, SpaceList,
    ToolResultRequest, TurnEvent, TurnRequest,
};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::http::{Endpoint, Response, send};

/// The brain at a base URL such as `http://127.0.0.1:8787/v0`, and endue AI's API gateway for the
/// agent directory (`/api/v1/...`), by default at the base URL's origin.
#[derive(Debug, Clone)]
pub struct HttpBrain {
    endpoint: Endpoint,
    gateway: Endpoint,
    token: Option<String>,
}

impl HttpBrain {
    pub fn new(base_url: &str) -> Result<Self, String> {
        let endpoint = Endpoint::parse(base_url)?;
        Ok(Self {
            gateway: endpoint.origin(),
            endpoint,
            token: None,
        })
    }

    /// Reach the API gateway at `url` (such as `https://platform.endue.ai`) instead of the base
    /// URL's origin.
    pub fn with_gateway(mut self, url: &str) -> Result<Self, String> {
        self.gateway = Endpoint::parse(url)?;
        Ok(self)
    }

    pub fn gateway_url(&self) -> String {
        self.gateway.url()
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
        self.exchange_at(&self.endpoint, method, path, body)
    }

    fn exchange_at(
        &self,
        endpoint: &Endpoint,
        method: &str,
        path: &str,
        body: Option<&Value>,
    ) -> Result<Response, BrainFailure> {
        let response =
            send(endpoint, self.token.as_deref(), method, path, body).map_err(unreachable)?;
        if response.status < 300 {
            return Ok(response);
        }
        let status = response.status;
        let body = response.json().map_err(unreachable)?;
        match serde_json::from_value::<BrainError>(body.clone()) {
            Ok(error) => Err(BrainFailure::Refused { status, error }),
            // The gateway answers a missing or expired token with its own error body.
            Err(_) if status == 401 => Err(BrainFailure::Refused {
                status,
                error: BrainError {
                    code: BrainErrorCode::Unauthorized,
                    message: body.to_string(),
                    holder: None,
                },
            }),
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
        self.call_at(&self.endpoint, method, path, body)
    }

    /// GET a gateway path, with the same bearer token.
    fn gateway_get<T: DeserializeOwned>(&self, path: &str) -> Result<T, BrainFailure> {
        self.call_at(&self.gateway, "GET", path, NO_BODY)
    }

    fn call_at<T: DeserializeOwned>(
        &self,
        endpoint: &Endpoint,
        method: &str,
        path: &str,
        body: Option<&impl Serialize>,
    ) -> Result<T, BrainFailure> {
        let body = body.map(to_json).transpose()?;
        let value = self
            .exchange_at(endpoint, method, path, body.as_ref())?
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

/// `/api/v1/agents` with the page asked for; absent parameters are left out.
fn agents_path(query: &AgentQuery) -> String {
    let params: Vec<String> = [("page", query.page), ("limit", query.limit)]
        .into_iter()
        .filter_map(|(name, value)| value.map(|value| format!("{name}={value}")))
        .collect();
    if params.is_empty() {
        "/api/v1/agents".to_owned()
    } else {
        format!("/api/v1/agents?{}", params.join("&"))
    }
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
        self.gateway_get(&agents_path(query))
    }

    fn list_spaces(&self) -> Result<SpaceList, BrainFailure> {
        self.gateway_get("/api/v1/spaces")
    }

    fn list_space_agents(&self, space_id: &str) -> Result<SpaceAgentList, BrainFailure> {
        self.gateway_get(&format!("/api/v1/spaces/{}/agents", segment(space_id)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_strings_leave_absent_parameters_out() {
        assert_eq!(agents_path(&AgentQuery::default()), "/api/v1/agents");
        let second = AgentQuery {
            page: Some(2),
            limit: Some(50),
        };
        assert_eq!(agents_path(&second), "/api/v1/agents?page=2&limit=50");
        let limit = AgentQuery {
            limit: Some(5),
            ..AgentQuery::default()
        };
        assert_eq!(agents_path(&limit), "/api/v1/agents?limit=5");
    }

    #[test]
    fn the_gateway_defaults_to_the_brain_origin() {
        let brain = HttpBrain::new("http://127.0.0.1:8787/v0").unwrap();
        assert_eq!(brain.gateway_url(), "http://127.0.0.1:8787");
        let brain = brain.with_gateway("http://gateway:9000").unwrap();
        assert_eq!(brain.gateway_url(), "http://gateway:9000");
        assert_eq!(brain.base_url(), "http://127.0.0.1:8787/v0");
        assert!(
            HttpBrain::new("http://b/v0")
                .unwrap()
                .with_gateway("ftp://x")
                .is_err()
        );
    }
}
