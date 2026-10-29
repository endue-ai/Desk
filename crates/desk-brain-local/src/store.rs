//! The local brain's state: sessions, their leases and conversations, kept in one JSON file. Lease
//! rules follow specs/brain/v0 the way examples/brain-echo applies them.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use desk_brain::{
    BrainError, BrainErrorCode, BrainFailure, Lease, LeaseHolder, Session, SessionStatus, ToolCall,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::time::rfc3339;

/// The file in the caller's folder that holds the state.
pub const STATE_FILE: &str = "local-brain.json";

/// Everything the local brain remembers. The format is this crate's own, not a contract.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct State {
    /// The last number handed out in an id.
    next: u64,
    sessions: BTreeMap<String, Stored>,
}

/// One session as stored.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stored {
    id: String,
    title: Option<String>,
    created_at: String,
    pub updated_at: String,
    /// The last lease handed out, while it has not been released or taken over. It may be past its
    /// expiry: leases end lazily, when they are next looked at.
    lease: Option<Held>,
    /// Leases that ended, and how.
    ended: BTreeMap<String, Ended>,
    /// The conversation so far, as Ollama messages.
    pub messages: Vec<Value>,
    /// A turn that stopped for tool results.
    pub waiting: Option<Waiting>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Held {
    lease: Lease,
    expires_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Ended {
    Released,
    Lost,
    Expired,
}

/// A turn waiting for the results of its tool calls, which go out one at a time.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Waiting {
    pub turn_id: String,
    /// The model's message that asked for the calls; it enters the conversation with the results.
    pub assistant: Value,
    pub calls: Vec<ToolCall>,
    /// The `tool` messages of the calls answered so far, in order.
    pub results: Vec<Value>,
}

impl State {
    /// The state in `folder`, or a fresh one when the folder holds none yet.
    pub fn load(folder: &Path) -> Result<Self, String> {
        let path = folder.join(STATE_FILE);
        match fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str(&text)
                .map_err(|e| format!("{} is not a local brain state: {e}", path.display())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(format!("{} cannot be read: {e}", path.display())),
        }
    }

    /// Write the state to `folder` through a temporary file, so a crash leaves the old or the new.
    pub fn save(&self, folder: &Path) -> Result<(), BrainFailure> {
        let path = folder.join(STATE_FILE);
        let temporary: PathBuf = folder.join(format!("{STATE_FILE}.tmp"));
        let text = serde_json::to_string(self).map_err(|e| internal(e.to_string()))?;
        fs::write(&temporary, text)
            .and_then(|()| fs::rename(&temporary, &path))
            .map_err(|e| internal(format!("{} cannot be written: {e}", path.display())))
    }

    /// A new id: the prefix and the next number.
    pub fn id(&mut self, prefix: &str) -> String {
        self.next += 1;
        format!("{prefix}{}", self.next)
    }

    pub fn create_session(&mut self, title: Option<String>, now: u64) -> Session {
        let id = self.id("s");
        let stored = Stored {
            id: id.clone(),
            title,
            created_at: rfc3339(now),
            updated_at: rfc3339(now),
            lease: None,
            ended: BTreeMap::new(),
            messages: Vec::new(),
            waiting: None,
        };
        let session = stored.session(now);
        self.sessions.insert(id, stored);
        session
    }

    pub fn session(&self, id: &str) -> Result<&Stored, BrainFailure> {
        self.sessions
            .get(id)
            .ok_or_else(|| not_found(format!("There is no session {id}.")))
    }

    pub fn session_mut(&mut self, id: &str) -> Result<&mut Stored, BrainFailure> {
        self.sessions
            .get_mut(id)
            .ok_or_else(|| not_found(format!("There is no session {id}.")))
    }

    pub fn acquire(
        &mut self,
        session_id: &str,
        holder: &LeaseHolder,
        ttl: u64,
        takeover: bool,
        now: u64,
    ) -> Result<Lease, BrainFailure> {
        let lease_id = self.id("l");
        let stored = self.session_mut(session_id)?;
        if let Some(held) = stored.lease.take() {
            let in_force = held.expires_ms > now;
            let same = held.lease.holder.desk_id == holder.desk_id;
            if in_force && !same && !takeover {
                let error = held_by(session_id, &held.lease.holder);
                stored.lease = Some(held);
                return Err(error);
            }
            let ended = match (in_force, same) {
                (false, _) => Ended::Expired,
                (true, true) => Ended::Released,
                (true, false) => Ended::Lost,
            };
            stored.ended.insert(held.lease.lease_id, ended);
        }
        let lease = Lease {
            lease_id,
            session_id: session_id.to_owned(),
            holder: holder.clone(),
            acquired_at: rfc3339(now),
            expires_at: rfc3339(now + ttl * 1_000),
            ttl_seconds: ttl,
        };
        stored.lease = Some(Held {
            lease: lease.clone(),
            expires_ms: now + ttl * 1_000,
        });
        Ok(lease)
    }
}

impl Stored {
    /// The session as the contract shows it.
    pub fn session(&self, now: u64) -> Session {
        Session {
            id: self.id.clone(),
            title: self.title.clone(),
            status: SessionStatus::Active,
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
            lease: self.current(now).cloned(),
        }
    }

    /// The lease in force at `now`.
    pub fn current(&self, now: u64) -> Option<&Lease> {
        self.lease
            .as_ref()
            .filter(|held| held.expires_ms > now)
            .map(|held| &held.lease)
    }

    /// Only the holder of the lease in force may write.
    pub fn writer(&self, lease_id: &str, now: u64) -> Result<(), BrainFailure> {
        let current = self.current(now);
        if current.is_some_and(|lease| lease.lease_id == lease_id) {
            return Ok(());
        }
        let holder = current.map(|lease| lease.holder.clone());
        match (self.ended.get(lease_id), holder) {
            (Some(Ended::Lost), holder) => Err(conflict(
                BrainErrorCode::LeaseLost,
                format!("Lease {lease_id} was taken over."),
                holder,
            )),
            (None, Some(holder)) => Err(held_by(&self.id, &holder)),
            _ => Err(conflict(
                BrainErrorCode::LeaseExpired,
                format!("Lease {lease_id} is no longer in force; acquire it again."),
                None,
            )),
        }
    }

    pub fn renew(
        &mut self,
        lease_id: &str,
        ttl: Option<u64>,
        now: u64,
    ) -> Result<Lease, BrainFailure> {
        self.writer(lease_id, now)?;
        let held = self.lease.as_mut().expect("the writer holds a lease");
        let ttl = ttl.unwrap_or(held.lease.ttl_seconds);
        held.expires_ms = now + ttl * 1_000;
        held.lease.ttl_seconds = ttl;
        held.lease.expires_at = rfc3339(held.expires_ms);
        Ok(held.lease.clone())
    }

    pub fn release(&mut self, lease_id: &str, now: u64) -> Result<(), BrainFailure> {
        self.writer(lease_id, now)?;
        self.lease = None;
        self.ended.insert(lease_id.to_owned(), Ended::Released);
        Ok(())
    }
}

fn held_by(session_id: &str, holder: &LeaseHolder) -> BrainFailure {
    let name = holder.name.as_deref().unwrap_or(&holder.desk_id);
    conflict(
        BrainErrorCode::LeaseHeld,
        format!("Session {session_id} is open on {name}."),
        Some(holder.clone()),
    )
}

fn refusal(
    status: u16,
    code: BrainErrorCode,
    message: String,
    holder: Option<LeaseHolder>,
) -> BrainFailure {
    BrainFailure::Refused {
        status,
        error: BrainError {
            code,
            message,
            holder,
        },
    }
}

fn conflict(code: BrainErrorCode, message: String, holder: Option<LeaseHolder>) -> BrainFailure {
    refusal(409, code, message, holder)
}

pub fn invalid(message: impl Into<String>) -> BrainFailure {
    refusal(400, BrainErrorCode::InvalidRequest, message.into(), None)
}

pub fn not_found(message: impl Into<String>) -> BrainFailure {
    refusal(404, BrainErrorCode::NotFound, message.into(), None)
}

pub fn internal(message: impl Into<String>) -> BrainFailure {
    refusal(500, BrainErrorCode::Internal, message.into(), None)
}
