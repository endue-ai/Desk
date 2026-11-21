//! The kept-password side of `Core` (ADR 0311): db.passwords.set, db.passwords.delete and
//! db.passwords.list, scoped to the caller, and the password `db.open` signs in with when it names
//! one by `passwordRef`. Keeping one needs the plugin's manifest to declare `db:connect` for its host
//! and port, and no grant, since using it is `db.open`'s, checked against the grant; forgetting and
//! listing reach only the caller's own. Agents are refused. The keychain is never read while the
//! table is locked, so a keychain that asks the person holds up no other call.

use std::path::PathBuf;
use std::sync::{Arc, MutexGuard};

use desk_bridge::{
    BridgeError, DbConnectPermission, DbKeptPassword, DbOpenParams, DbPasswordsDeleteParams,
    DbPasswordsDeleteResult, DbPasswordsListParams, DbPasswordsListResult, DbPasswordsSetParams,
    DbPasswordsSetResult, ErrorCode, Permission,
};
use desk_sys::keychain::Keychain;

use crate::agents::agent_of;
use crate::db_passwords::{Bound, DbPasswords, secret_for};
use crate::handler::{Answer, Core, error, json, sys_error};

impl Core {
    /// Keep database passwords in `keychain`, with the index of what is kept in `file`
    /// (`db-passwords.json` in the data folder). Without one, `db.passwords.set` is `unsupported`.
    pub fn with_db_passwords(
        self,
        keychain: Option<Arc<dyn Keychain>>,
        file: Option<PathBuf>,
    ) -> Self {
        *self.lock_db_passwords() = DbPasswords::new(keychain, file);
        self
    }

    pub(crate) fn db_passwords_set(&self, caller: &str, params: DbPasswordsSetParams) -> Answer {
        refuse_agents(caller)?;
        let port = port(params.port)?;
        let scope = Permission::DbConnect(DbConnectPermission {
            permission: Default::default(),
            hosts: vec![format!("{}:{port}", params.host)],
        });
        if self.undeclared(caller, &scope) {
            let why = format!(
                "{caller} does not declare db:connect for {}:{port}",
                params.host
            );
            return Err(BridgeError {
                code: ErrorCode::PermissionDenied,
                message: why,
                permission: Some(scope),
            });
        }
        let bound = Bound {
            host: params.host,
            port,
            user: params.user,
        };
        self.lock_db_passwords()
            .set(caller, &params.name, bound, params.password)
            .map_err(sys_error)?;
        json(DbPasswordsSetResult {})
    }

    pub(crate) fn db_passwords_delete(
        &self,
        caller: &str,
        params: DbPasswordsDeleteParams,
    ) -> Answer {
        refuse_agents(caller)?;
        self.lock_db_passwords()
            .delete(caller, &params.name)
            .map_err(sys_error)?;
        json(DbPasswordsDeleteResult {})
    }

    pub(crate) fn db_passwords_list(&self, caller: &str, _params: DbPasswordsListParams) -> Answer {
        refuse_agents(caller)?;
        let passwords = self.lock_db_passwords().list(caller).into_iter();
        let passwords = passwords.map(|(name, bound)| DbKeptPassword {
            name,
            host: bound.host,
            port: bound.port.into(),
            user: bound.user,
        });
        json(DbPasswordsListResult {
            passwords: passwords.collect(),
        })
    }

    /// The password `db.open` signs in with: the one given, else, for a `passwordRef`, none when the
    /// password file has a line for the session (it answers first), else the caller's kept one when
    /// it was kept for this host, port and user. A name kept for another server, one gone from the
    /// keychain or a keychain that does not answer give none, so the server's ask is `needsPassword`.
    pub(crate) fn db_password(
        &self,
        caller: &str,
        params: &DbOpenParams,
        port: u16,
    ) -> Result<Option<String>, BridgeError> {
        let Some(name) = &params.password_ref else {
            return Ok(params.password.clone());
        };
        if params.password.is_some() {
            let why = "db.open takes a password or a passwordRef, not both".to_owned();
            return Err(error(ErrorCode::InvalidParams, why));
        }
        let file = desk_pg::pgpass::default_file(self.home());
        let (host, database, user) = (&params.host, &params.database, &params.user);
        if desk_pg::pgpass::lookup(&file, host, port, database, user).is_some() {
            return Ok(None);
        }
        let bound = Bound {
            host: host.clone(),
            port,
            user: user.clone(),
        };
        let found = self.lock_db_passwords().lookup(caller, name, &bound);
        let Some((keychain, account)) = found else {
            return Ok(None);
        };
        Ok(match keychain.get(&account) {
            Ok(Some(text)) => secret_for(&text, &bound),
            Ok(None) => {
                self.lock_db_passwords().drop_entry(caller, name);
                None
            }
            Err(_) => None,
        })
    }

    /// The plugin was removed: every password it kept goes.
    pub(crate) fn forget_db_passwords(&self, plugin: &str) {
        self.lock_db_passwords().forget_plugin(plugin);
    }

    fn lock_db_passwords(&self) -> MutexGuard<'_, DbPasswords> {
        self.db_passwords
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn port(port: Option<u64>) -> Result<u16, BridgeError> {
    u16::try_from(port.unwrap_or(5432))
        .ok()
        .filter(|port| *port > 0)
        .ok_or_else(|| error(ErrorCode::InvalidParams, "a port is 1 to 65535".to_owned()))
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
