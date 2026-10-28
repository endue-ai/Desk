//! The brain contract for Rust: the `Brain` trait, one method per operation of
//! `specs/brain/v0/openapi.yaml`, and the types generated from it. Clients (desk-brain-endue,
//! desk-brain-local) implement the trait; desk-core only talks to the trait.
pub const NAME: &str = env!("CARGO_PKG_NAME");

mod generated;
pub use generated::*;

use std::fmt;

/// Why a brain call failed.
#[derive(Debug, Clone, PartialEq)]
pub enum BrainFailure {
    /// The brain answered with an error: lease conflicts, unknown sessions, invalid requests.
    Refused { status: u16, error: BrainError },
    /// The brain could not be reached, or the connection broke before the answer was complete.
    Unreachable(String),
    /// The brain answered something the contract does not allow.
    Protocol(String),
}

impl BrainFailure {
    /// The contract's error code, when the brain gave one.
    pub fn code(&self) -> Option<BrainErrorCode> {
        match self {
            Self::Refused { error, .. } => Some(error.code),
            _ => None,
        }
    }
}

impl fmt::Display for BrainFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Refused { status, error } => {
                write!(f, "the brain refused ({status}): {}", error.message)
            }
            Self::Unreachable(why) => write!(f, "the brain is unreachable: {why}"),
            Self::Protocol(why) => write!(f, "the brain broke the contract: {why}"),
        }
    }
}

impl std::error::Error for BrainFailure {}

/// The page `list_agents` asks for; `None` leaves a parameter out, so the gateway's default applies.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct AgentQuery {
    /// The page to read, from 1 (default 1; the gateway reads anything lower as 1).
    pub page: Option<u64>,
    /// Items per page (default 20; the gateway lowers anything over 50 to 50).
    pub limit: Option<u64>,
}

/// A brain, as Desk sees it. Calls block until the brain answers; turn streams hand each event to
/// `on_event` as it arrives and return once the stream has ended.
pub trait Brain: Send + Sync {
    fn create_session(&self, request: &CreateSessionRequest) -> Result<Session, BrainFailure>;

    fn get_session(&self, session_id: &str) -> Result<Session, BrainFailure>;

    /// Send a message. A turn.completed with stopReason tool_call waits for `submit_tool_result`.
    fn create_turn(
        &self,
        session_id: &str,
        request: &TurnRequest,
        on_event: &mut dyn FnMut(TurnEvent),
    ) -> Result<(), BrainFailure>;

    /// Return a tool's result and stream the rest of the turn.
    fn submit_tool_result(
        &self,
        session_id: &str,
        turn_id: &str,
        request: &ToolResultRequest,
        on_event: &mut dyn FnMut(TurnEvent),
    ) -> Result<(), BrainFailure>;

    /// The lease in force; `Refused` with status 404 when there is none.
    fn get_lease(&self, session_id: &str) -> Result<Lease, BrainFailure>;

    fn acquire_lease(
        &self,
        session_id: &str,
        request: &LeaseAcquireRequest,
    ) -> Result<Lease, BrainFailure>;

    fn renew_lease(
        &self,
        session_id: &str,
        lease_id: &str,
        request: &LeaseRenewRequest,
    ) -> Result<Lease, BrainFailure>;

    fn release_lease(&self, session_id: &str, lease_id: &str) -> Result<(), BrainFailure>;

    /// One page of the caller's agents (endue AI's API gateway, `GET /api/v1/agents`).
    fn list_agents(&self, query: &AgentQuery) -> Result<AgentList, BrainFailure>;

    /// The caller's active spaces (`GET /api/v1/spaces`).
    fn list_spaces(&self) -> Result<SpaceList, BrainFailure>;

    /// Which agents take part in a space; `Refused` with status 404 for an unknown space
    /// (`GET /api/v1/spaces/{spaceId}/agents`).
    fn list_space_agents(&self, space_id: &str) -> Result<SpaceAgentList, BrainFailure>;
}
