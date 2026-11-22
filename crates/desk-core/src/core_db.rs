//! The database side of `Core`: db.open, db.run, db.fetch, db.copy, db.cancel, db.close and
//! db.list over PostgreSQL sessions of `desk-pg` (ADR 0281), behind `db:connect` as `net:connect`
//! guards sockets (`core_sockets.rs`). A session belongs to its caller: another caller's id is
//! `not_found`, and it ends at db.close, when the caller unloads, when its grants no longer cover
//! the host and port, and when the desk quits (`core_db_end.rs`, ADR 0339).
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
use crate::core_db_ssh::{Tunnelled, hops_of};
use crate::db_wire::{
    KeyCheck, auth, client_cert, empty_open, event, page, server_error, tls_info, tls_mode,
    transaction,
};
use crate::handler::{Answer, Core, error, json};
use crate::perm::Target;

/// How many sessions one caller holds at once.
pub(crate) const MAX_SESSIONS: usize = 16;
/// The one engine the core speaks.
const POSTGRESQL: &str = "postgresql";

pub(crate) struct DbEntry {
    pub(crate) caller: String,
    pub(crate) scope: Permission,
    pub(crate) host: String,
    pub(crate) port: u16,
    /// Its SSH tunnel's hops, the jump host first (ADR 0359).
    pub(crate) hops: Vec<(String, u16)>,
    database: String,
    user: String,
    pid: i64,
    /// `None` while it signs in.
    pub(crate) session: Option<Arc<Session>>,
    /// Why the desk let it go while it signed in; the sign-in then ends it so.
    pub(crate) ended: Option<CloseReason>,
}

/// The sessions callers opened, by id. Shared with each session's sink, which removes the entry
/// once the session has ended.
#[derive(Default)]
pub(crate) struct Databases {
    next: u64,
    pub(crate) entries: BTreeMap<String, DbEntry>,
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
        self.db_ssh_check(caller, &scope, &params)?;
        if params.engine != POSTGRESQL {
            let why = format!("the desk speaks {POSTGRESQL}, not {}", params.engine);
            return Err(error(ErrorCode::Unsupported, why));
        }
        let mut config = self.db_config(caller, &params, port)?;
        config.client_cert = match client_cert(params.tls.as_ref()) {
            Ok(client) => client,
            Err(KeyCheck::Answer(key_password)) => {
                let key_password = Some(key_password);
                return json(DbOpenResult {
                    key_password,
                    ..empty_open()
                });
            }
            Err(KeyCheck::Refused(refused)) => return Err(refused),
        };
        let id = self.db_reserve(caller, scope, &params, port)?;
        if let Some(ssh) = &params.ssh {
            let at = (params.host.as_str(), port);
            match self.db_tunnel(caller, ssh, at, config.timeout) {
                Ok(Tunnelled::Via(via)) => config.via = Some(via),
                Ok(Tunnelled::Answer(answer)) => {
                    lock(&self.databases).entries.remove(&id);
                    return json(DbOpenResult {
                        ssh: Some(answer),
                        ..empty_open()
                    });
                }
                Err(refused) => {
                    lock(&self.databases).entries.remove(&id);
                    return Err(refused);
                }
            }
        }
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

    /// The session's config: the password given or kept (ADR 0311), the password file under the
    /// desk's home, the limits checked; the client certificate is `client_cert`'s (ADR 0331).
    fn db_config(
        &self,
        caller: &str,
        params: &DbOpenParams,
        port: u16,
    ) -> Result<Config, BridgeError> {
        let mut config = Config::new(&params.host, port, &params.database, &params.user);
        config.password = self.db_password(caller, params, port)?;
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
            hops: hops_of(params),
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
    pub(crate) fn db_session(&self, caller: &str, id: &str) -> Result<Arc<Session>, BridgeError> {
        refuse_agents(caller)?;
        lock(&self.databases)
            .entries
            .get(id)
            .filter(|entry| entry.caller == caller)
            .and_then(|entry| entry.session.clone())
            .ok_or_else(|| error(ErrorCode::NotFound, format!("{caller} has no session {id}")))
    }

    /// How many sessions are open or signing in, for tests and diagnostics.
    pub fn database_count(&self) -> usize {
        lock(&self.databases).entries.len()
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

pub(crate) fn limits(rows: Option<u64>, bytes: Option<u64>) -> Result<Limits, BridgeError> {
    Limits::new(rows, bytes).map_err(db_error)
}

/// A session's failure as the bridge says it.
pub(crate) fn db_error(failure: desk_pg::Error) -> BridgeError {
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
