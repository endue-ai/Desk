//! The database side of `Core`: db.open, db.run, db.fetch, db.copy, db.cancel, db.close and
//! db.list over PostgreSQL sessions of `desk-pg` (ADR 0281), behind `db:connect` as `net:connect`
//! guards sockets (`core_sockets.rs`). A session belongs to its caller: another caller's id is
//! `not_found`, and it ends when the caller unloads or its grants no longer cover the host and port.
//! Its events go to that caller alone; `db.closed` once its entry has left the table. The table is
//! never locked while a session's call waits on the server.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::Duration;

use base64::Engine as _;
use desk_bridge::{
    BridgeError, DbCancelParams, DbCancelResult, DbCloseParams, DbCloseResult, DbCopyParams,
    DbFetchParams, DbListParams, DbListResult, DbOpenParams, DbOpenResult, DbRunParams,
    DbSessionInfo, Encoding, ErrorCode, Permission, True,
};
use desk_pg::{CloseReason, Config, CopyInput, Limits, Session, Statement};

use crate::agents::agent_of;
use crate::db_wire::{auth, event, page, server_error, tls_info, tls_mode, transaction};
use crate::handler::{Answer, Core, error, json};
use crate::perm::Target;

/// How many sessions one caller holds at once.
pub(crate) const MAX_SESSIONS: usize = 16;
/// The one engine the core speaks.
const POSTGRESQL: &str = "postgresql";

struct DbEntry {
    caller: String,
    scope: Permission,
    host: String,
    port: u16,
    database: String,
    user: String,
    pid: i64,
    /// `None` while it signs in.
    session: Option<Arc<Session>>,
    /// Why the desk let it go while it signed in; the sign-in then ends it so.
    ended: Option<CloseReason>,
}

/// The sessions callers opened, by id. Shared with each session's sink, which removes the entry
/// once the session has ended.
#[derive(Default)]
pub(crate) struct Databases {
    next: u64,
    entries: BTreeMap<String, DbEntry>,
}

impl Core {
    pub(crate) fn db_open(&self, caller: &str, params: DbOpenParams) -> Answer {
        refuse_agents(caller)?;
        let port = u16::try_from(params.port.unwrap_or(5432))
            .map_err(|_| error(ErrorCode::InvalidParams, "a port is 1 to 65535".to_owned()))?;
        let scope = Permission::DbConnect(params.scope.clone());
        let target = Target::Endpoint {
            host: &params.host,
            port,
        };
        self.check(caller, &scope, &target)?;
        if params.engine != POSTGRESQL {
            let why = format!("the desk speaks {POSTGRESQL}, not {}", params.engine);
            return Err(error(ErrorCode::Unsupported, why));
        }
        let config = self.db_config(&params, port)?;
        let id = self.db_reserve(caller, scope, &params, port)?;
        let sink = event(
            id.clone(),
            caller.to_owned(),
            self.events().clone(),
            Arc::downgrade(&self.databases),
        );
        let opened = match desk_pg::open(config, sink) {
            Ok(opened) => opened,
            Err(failure) => {
                lock(&self.databases).entries.remove(&id);
                return match failure {
                    desk_pg::Error::Refused(refusal) => json(DbOpenResult {
                        error: Some(server_error(&refusal)),
                        ..empty_open()
                    }),
                    desk_pg::Error::NeedsPassword => json(DbOpenResult {
                        needs_password: Some(True),
                        ..empty_open()
                    }),
                    other => Err(db_error(other)),
                };
            }
        };
        let session = Arc::new(opened.session);
        let ended = {
            let mut databases = lock(&self.databases);
            match databases.entries.get_mut(&id) {
                Some(entry) if entry.ended.is_none() => {
                    (entry.session, entry.pid) = (Some(session.clone()), opened.pid.into());
                    None
                }
                Some(entry) => entry.ended,
                None => Some(CloseReason::Desk),
            }
        };
        if let Some(reason) = ended {
            lock(&self.databases).entries.remove(&id);
            session.close(reason);
            let why = "the session ended while it signed in".to_owned();
            return Err(error(ErrorCode::IoError, why));
        }
        json(DbOpenResult {
            session_id: Some(id),
            pid: Some(opened.pid.into()),
            auth: Some(auth(opened.auth)),
            tls: opened.tls.as_ref().map(tls_info),
            parameters: Some(opened.parameters.into_iter().collect()),
            ..empty_open()
        })
    }

    /// The session's config: the password file under the desk's home, the limits checked.
    fn db_config(&self, params: &DbOpenParams, port: u16) -> Result<Config, BridgeError> {
        let mut config = Config::new(&params.host, port, &params.database, &params.user);
        config.password = params.password.clone();
        config.password_file = Some(desk_pg::pgpass::default_file(self.home()));
        if let Some(tls) = &params.tls {
            config.tls = tls_mode(tls.mode);
            config.ca_pem = tls.ca.as_ref().map(|pem| pem.as_bytes().to_vec());
        }
        config.settings = params
            .settings
            .clone()
            .unwrap_or_default()
            .into_iter()
            .collect();
        config.read_only = params.read_only == Some(true);
        if let Some(ms) = params.timeout_ms {
            config.timeout = Duration::from_millis(ms);
        }
        config.check().map_err(db_error)?;
        Ok(config)
    }

    /// A place in the table before anything connects, so a caller's 17th session is refused.
    fn db_reserve(
        &self,
        caller: &str,
        scope: Permission,
        params: &DbOpenParams,
        port: u16,
    ) -> Result<String, BridgeError> {
        let mut databases = lock(&self.databases);
        let held = databases.entries.values().filter(|e| e.caller == caller);
        if held.count() >= MAX_SESSIONS {
            let why = format!("{caller} already holds {MAX_SESSIONS} database sessions");
            return Err(error(ErrorCode::InvalidValue, why));
        }
        databases.next += 1;
        let id = format!("d-{}", databases.next);
        let entry = DbEntry {
            caller: caller.to_owned(),
            scope,
            host: params.host.clone(),
            port,
            database: params.database.clone(),
            user: params.user.clone(),
            pid: 0,
            session: None,
            ended: None,
        };
        databases.entries.insert(id.clone(), entry);
        Ok(id)
    }

    pub(crate) fn db_run(&self, caller: &str, params: DbRunParams) -> Answer {
        refuse_agents(caller)?;
        let limits = limits(params.page_rows, params.page_bytes)?;
        let session = self.db_session(caller, &params.session_id)?;
        let types = params.param_types.unwrap_or_default().into_iter();
        let statement = Statement {
            sql: params.sql,
            params: params.params.unwrap_or_default(),
            types: types.map(|oid| u32::try_from(oid).unwrap_or(0)).collect(),
        };
        json(page(session.run(statement, limits).map_err(db_error)?))
    }

    pub(crate) fn db_fetch(&self, caller: &str, params: DbFetchParams) -> Answer {
        refuse_agents(caller)?;
        let limits = limits(params.page_rows, params.page_bytes)?;
        let session = self.db_session(caller, &params.session_id)?;
        let close = params.close == Some(true);
        json(page(session.fetch(limits, close).map_err(db_error)?))
    }

    pub(crate) fn db_copy(&self, caller: &str, params: DbCopyParams) -> Answer {
        let session = self.db_session(caller, &params.session_id)?;
        let data = match (params.data, params.encoding) {
            (None, _) => None,
            (Some(data), Some(Encoding::Base64)) => {
                let bytes = base64::engine::general_purpose::STANDARD.decode(data);
                let bytes = bytes.map_err(|e| error(ErrorCode::InvalidParams, e.to_string()))?;
                Some(bytes)
            }
            (Some(data), _) => Some(data.into_bytes()),
        };
        let input = CopyInput {
            data,
            done: params.done == Some(true),
            fail: params.fail,
        };
        json(page(session.copy(input).map_err(db_error)?))
    }

    pub(crate) fn db_cancel(&self, caller: &str, params: DbCancelParams) -> Answer {
        let session = self.db_session(caller, &params.session_id)?;
        session.cancel().map_err(db_error)?;
        json(DbCancelResult {})
    }

    pub(crate) fn db_close(&self, caller: &str, params: DbCloseParams) -> Answer {
        refuse_agents(caller)?;
        let mut databases = lock(&self.databases);
        let owned = databases.entries.get(&params.session_id);
        if owned.is_some_and(|entry| entry.caller == caller && entry.session.is_some()) {
            let entry = databases.entries.remove(&params.session_id);
            drop(databases);
            if let Some(session) = entry.and_then(|e| e.session) {
                session.close(CloseReason::Closed);
            }
        }
        json(DbCloseResult {})
    }

    pub(crate) fn db_list(&self, caller: &str, _params: DbListParams) -> Answer {
        refuse_agents(caller)?;
        let databases = lock(&self.databases);
        let sessions = databases.entries.iter().filter_map(|(id, entry)| {
            let session = entry.session.as_ref().filter(|_| entry.caller == caller)?;
            Some(DbSessionInfo {
                session_id: id.clone(),
                host: entry.host.clone(),
                port: entry.port.into(),
                database: entry.database.clone(),
                user: entry.user.clone(),
                pid: entry.pid,
                running: session.running(),
                more: session.more(),
                transaction: transaction(session.transaction()),
            })
        });
        json(DbListResult {
            sessions: sessions.collect(),
        })
    }

    /// One of the caller's signed-in sessions.
    fn db_session(&self, caller: &str, id: &str) -> Result<Arc<Session>, BridgeError> {
        refuse_agents(caller)?;
        lock(&self.databases)
            .entries
            .get(id)
            .filter(|entry| entry.caller == caller)
            .and_then(|entry| entry.session.clone())
            .ok_or_else(|| error(ErrorCode::NotFound, format!("{caller} has no session {id}")))
    }

    /// The caller unloaded: its sessions end (`unloaded`).
    pub(crate) fn drop_databases(&self, caller: &str) {
        self.end_databases(caller, CloseReason::Unloaded, |_| true);
    }

    /// End the caller's sessions that its grants no longer cover (`revoked`).
    pub(crate) fn prune_databases(&self, caller: &str) {
        let permissions = self.permissions();
        let lost = |entry: &DbEntry| {
            let target = Target::Endpoint {
                host: &entry.host,
                port: entry.port,
            };
            permissions
                .authorize(caller, &entry.scope, &target)
                .is_err()
        };
        let ended = take(
            &mut lock(&self.databases),
            caller,
            CloseReason::Revoked,
            lost,
        );
        drop(permissions);
        close_all(ended, CloseReason::Revoked);
    }

    fn end_databases(&self, caller: &str, reason: CloseReason, ends: impl Fn(&DbEntry) -> bool) {
        let ended = take(&mut lock(&self.databases), caller, reason, ends);
        close_all(ended, reason);
    }

    /// How many sessions are open or signing in, for tests and diagnostics.
    pub fn database_count(&self) -> usize {
        lock(&self.databases).entries.len()
    }
}

/// Take the caller's signed-in sessions `ends` picks out of the table; mark those still signing in.
fn take(
    databases: &mut Databases,
    caller: &str,
    reason: CloseReason,
    ends: impl Fn(&DbEntry) -> bool,
) -> Vec<Arc<Session>> {
    let mut ended = Vec::new();
    databases.entries.retain(|_, entry| {
        if entry.caller != caller || !ends(entry) {
            return true;
        }
        match entry.session.take() {
            Some(session) => {
                ended.push(session);
                false
            }
            None => {
                entry.ended.get_or_insert(reason);
                true
            }
        }
    });
    ended
}

fn close_all(sessions: Vec<Arc<Session>>, reason: CloseReason) {
    for session in sessions {
        session.close(reason);
    }
}

fn refuse_agents(caller: &str) -> Result<(), BridgeError> {
    match agent_of(caller) {
        Some(_) => Err(error(
            ErrorCode::PermissionDenied,
            "agents reach databases through the plugin's commands".to_owned(),
        )),
        None => Ok(()),
    }
}

fn limits(rows: Option<u64>, bytes: Option<u64>) -> Result<Limits, BridgeError> {
    Limits::new(rows, bytes).map_err(db_error)
}

fn empty_open() -> DbOpenResult {
    DbOpenResult {
        session_id: None,
        pid: None,
        auth: None,
        tls: None,
        parameters: None,
        error: None,
        needs_password: None,
    }
}

/// A session's failure as the bridge says it.
fn db_error(failure: desk_pg::Error) -> BridgeError {
    use desk_pg::Error as E;
    let code = match &failure {
        E::Invalid(_) => ErrorCode::InvalidParams,
        E::Unsupported(_) => ErrorCode::Unsupported,
        E::Timeout => ErrorCode::Timeout,
        E::TooLarge(_) => ErrorCode::InvalidValue,
        E::Io(_) | E::Closed | E::Refused(_) | E::NeedsPassword => ErrorCode::IoError,
    };
    error(code, failure.to_string())
}

pub(crate) fn lock(databases: &Mutex<Databases>) -> MutexGuard<'_, Databases> {
    databases
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Remove an ended session's entry; called from its sink, on the sessions' runtime thread.
pub(crate) fn forget(databases: &Weak<Mutex<Databases>>, id: &str) {
    if let Some(databases) = databases.upgrade() {
        let entry = lock(&databases).entries.remove(id);
        drop(entry);
    }
}
