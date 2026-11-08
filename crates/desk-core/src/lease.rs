//! The session lease client. A session is written by one desk at a time, the holder of its lease;
//! opening it on another desk takes the lease over, and the previous desk becomes read-only.

use std::sync::Arc;
use std::time::{Duration, Instant};

use desk_brain::{
    Brain, BrainErrorCode, BrainFailure, Lease, LeaseAcquireRequest, LeaseHolder, LeaseRenewRequest,
};

/// Why this desk may not write right now.
#[derive(Debug, Clone, PartialEq)]
pub enum LeaseError {
    /// Another desk holds the session (it took it over, or held it when this desk asked). This desk
    /// stays read-only until it opens the session again.
    ReadOnly { holder: Option<LeaseHolder> },
    /// The lease ran out. Nobody was refused: acquiring again is allowed.
    Expired,
    /// No session has been opened yet.
    NoSession,
    /// The brain failed in another way (for example it is unreachable).
    Brain(BrainFailure),
}

#[derive(Debug, Clone)]
enum State {
    Free,
    Held { lease: Lease, since: Instant },
    ReadOnly { holder: Option<LeaseHolder> },
}

/// One desk's lease on one session at a time.
pub struct LeaseClient {
    brain: Arc<dyn Brain>,
    holder: LeaseHolder,
    ttl_seconds: u64,
    session: Option<String>,
    state: State,
}

impl LeaseClient {
    pub fn new(brain: Arc<dyn Brain>, holder: LeaseHolder, ttl_seconds: u64) -> Self {
        Self {
            brain,
            holder,
            ttl_seconds,
            session: None,
            state: State::Free,
        }
    }

    /// Open `session_id` on this desk: acquire its lease, taking it over from another desk when
    /// `takeover` is set. Without a takeover, a session held elsewhere leaves this desk read-only.
    pub fn acquire(&mut self, session_id: &str, takeover: bool) -> Result<&Lease, LeaseError> {
        self.session = Some(session_id.to_owned());
        let request = LeaseAcquireRequest {
            holder: self.holder.clone(),
            ttl_seconds: self.ttl_seconds,
            takeover: takeover.then_some(true),
        };
        match self.brain.acquire_lease(session_id, &request) {
            Ok(lease) => Ok(self.hold(lease)),
            Err(failure) => Err(self.refused(failure)),
        }
    }

    /// Extend the lease this desk holds.
    pub fn renew(&mut self) -> Result<&Lease, LeaseError> {
        let (session, lease_id) = self.held()?;
        let request = LeaseRenewRequest { ttl_seconds: None };
        match self.brain.renew_lease(&session, &lease_id, &request) {
            Ok(lease) => Ok(self.hold(lease)),
            Err(failure) => Err(self.refused(failure)),
        }
    }

    /// Give the lease up so another desk can acquire it without a takeover.
    pub fn release(&mut self) -> Result<(), LeaseError> {
        let (session, lease_id) = self.held()?;
        match self.brain.release_lease(&session, &lease_id) {
            Ok(()) => {
                self.state = State::Free;
                Ok(())
            }
            Err(failure) => Err(self.refused(failure)),
        }
    }

    /// The lease id to write with: a lease past half its ttl is renewed, and a free session is
    /// acquired again (without a takeover).
    pub fn ensure(&mut self) -> Result<String, LeaseError> {
        let session = self.session.clone().ok_or(LeaseError::NoSession)?;
        let half = Duration::from_secs(self.ttl_seconds) / 2;
        let lease = match &self.state {
            State::ReadOnly { holder } => {
                return Err(LeaseError::ReadOnly {
                    holder: holder.clone(),
                });
            }
            State::Held { lease, since } if since.elapsed() < half => {
                return Ok(lease.lease_id.clone());
            }
            State::Held { .. } => match self.renew() {
                Err(LeaseError::Expired) => self.acquire(&session, false)?,
                other => other?,
            },
            State::Free => self.acquire(&session, false)?,
        };
        Ok(lease.lease_id.clone())
    }

    /// A write was refused: record lease conflicts and say what they mean for this desk.
    pub fn refused(&mut self, failure: BrainFailure) -> LeaseError {
        let holder = match &failure {
            BrainFailure::Refused { error, .. } => error.holder.clone(),
            _ => None,
        };
        match failure.code() {
            Some(BrainErrorCode::LeaseHeld | BrainErrorCode::LeaseLost) => {
                self.state = State::ReadOnly {
                    holder: holder.clone(),
                };
                LeaseError::ReadOnly { holder }
            }
            Some(BrainErrorCode::LeaseExpired) => {
                self.state = State::Free;
                LeaseError::Expired
            }
            _ => LeaseError::Brain(failure),
        }
    }

    pub fn lease(&self) -> Option<&Lease> {
        match &self.state {
            State::Held { lease, .. } => Some(lease),
            _ => None,
        }
    }

    pub fn is_read_only(&self) -> bool {
        matches!(self.state, State::ReadOnly { .. })
    }

    pub fn session(&self) -> Option<&str> {
        self.session.as_deref()
    }

    fn hold(&mut self, lease: Lease) -> &Lease {
        self.state = State::Held {
            lease,
            since: Instant::now(),
        };
        match &self.state {
            State::Held { lease, .. } => lease,
            _ => unreachable!("the state was just set"),
        }
    }

    fn held(&self) -> Result<(String, String), LeaseError> {
        let session = self.session.clone().ok_or(LeaseError::NoSession)?;
        match &self.state {
            State::Held { lease, .. } => Ok((session, lease.lease_id.clone())),
            State::ReadOnly { holder } => Err(LeaseError::ReadOnly {
                holder: holder.clone(),
            }),
            State::Free => Err(LeaseError::Expired),
        }
    }
}
