//! The SSH tunnel side of `Core`'s db.open (ADR 0359): every hop's host and port checked against
//! the caller's db:connect grant before anything connects, the tunnel opened with `desk-ssh` (a key
//! file read by the core, the SSH agent, or a password given or kept under `passwordRef`), each
//! hop's host key checked against what the caller trusts or the person accepted, the first stream
//! to the database opened so the SSH host's refusal to reach it is said as such, and the session's
//! streams handed to `desk-pg` as channels of the tunnel. db.hostKeys.delete forgets a trusted key.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use desk_bridge::{
    BridgeError, DbHostKeysDeleteParams, DbHostKeysDeleteResult, DbKeyPassword, DbOpenParams,
    DbSsh, DbSshAnswer, DbSshHop, DbSshHopName, DbSshHostKey, DbSshHostKeyStatus, DbSshStage,
    ErrorCode, Permission, True,
};
use desk_pg::{Dial, Dialled};
use desk_ssh::{
    Auth, Failure, Hop, KeyStatus, Passphrase, Plan, Stage, Stream, Trust, Tunnel, Which,
};

use crate::db_passwords::{Bound, secret_for};
use crate::db_ssh_hosts::{DbSshHosts, Trusted};
use crate::handler::{Answer, Core, error, json};
use crate::perm::Target;

/// One hop as db.open names it: the SSH host's fields and a jump host's are the same.
struct Named<'a> {
    host: &'a str,
    port: Option<u64>,
    user: &'a str,
    key_file: Option<&'a str>,
    key_password: Option<&'a str>,
    agent: bool,
    password: Option<&'a str>,
    password_ref: Option<&'a str>,
    host_key: Option<&'a str>,
}

impl<'a> Named<'a> {
    fn host(ssh: &'a DbSsh) -> Self {
        Named {
            host: &ssh.host,
            port: ssh.port,
            user: &ssh.user,
            key_file: ssh.key_file.as_deref(),
            key_password: ssh.key_password.as_deref(),
            agent: ssh.agent.is_some(),
            password: ssh.password.as_deref(),
            password_ref: ssh.password_ref.as_deref(),
            host_key: ssh.host_key.as_deref(),
        }
    }

    fn jump(hop: &'a DbSshHop) -> Self {
        Named {
            host: &hop.host,
            port: hop.port,
            user: &hop.user,
            key_file: hop.key_file.as_deref(),
            key_password: hop.key_password.as_deref(),
            agent: hop.agent.is_some(),
            password: hop.password.as_deref(),
            password_ref: hop.password_ref.as_deref(),
            host_key: hop.host_key.as_deref(),
        }
    }

    fn port(&self) -> Result<u16, BridgeError> {
        u16::try_from(self.port.unwrap_or(22).max(1)).map_err(|_| {
            error(
                ErrorCode::InvalidParams,
                "an SSH port is 1 to 65535".to_owned(),
            )
        })
    }
}

/// The hops of `ssh`, the jump host first, with their ports.
fn named(ssh: &DbSsh) -> Vec<(Which, Named<'_>)> {
    let mut hops = Vec::new();
    if let Some(jump) = &ssh.jump {
        hops.push((Which::Jump, Named::jump(jump)));
    }
    hops.push((Which::Host, Named::host(ssh)));
    hops
}

/// Every hop's host and port, for the session's entry (its grant is checked on each change).
pub(crate) fn hops_of(params: &DbOpenParams) -> Vec<(String, u16)> {
    let Some(ssh) = &params.ssh else {
        return Vec::new();
    };
    let hops = named(ssh).into_iter();
    hops.filter_map(|(_, hop)| Some((hop.host.to_owned(), hop.port().ok()?)))
        .collect()
}

/// What `db_tunnel` hands db.open: the session's way to the database, or why the tunnel did not open.
pub(crate) enum Tunnelled {
    Via(Arc<dyn Dial>),
    Answer(DbSshAnswer),
}

impl Core {
    /// Keep the SSH host keys callers trust in `file` (`db-ssh-hosts.json` in the data folder);
    /// without one they are trusted for this run only.
    pub fn with_db_ssh_hosts(self, file: Option<PathBuf>) -> Self {
        *lock(&self.db_ssh_hosts) = DbSshHosts::new(file);
        self
    }

    /// db:connect for every hop of `params.ssh`, under the same scope as the database's.
    pub(crate) fn db_ssh_check(
        &self,
        caller: &str,
        scope: &Permission,
        params: &DbOpenParams,
    ) -> Result<(), BridgeError> {
        let Some(ssh) = &params.ssh else {
            return Ok(());
        };
        for (_, hop) in named(ssh) {
            let port = hop.port()?;
            self.check(
                caller,
                scope,
                &Target::Endpoint {
                    host: hop.host,
                    port,
                },
            )?;
        }
        Ok(())
    }

    /// Open the tunnel `ssh` names and its first stream to `host:port`.
    pub(crate) fn db_tunnel(
        &self,
        caller: &str,
        ssh: &DbSsh,
        (host, port): (&str, u16),
        timeout: Duration,
    ) -> Result<Tunnelled, BridgeError> {
        let mut hops = Vec::new();
        for (which, named) in named(ssh) {
            match self.hop(caller, which, &named)? {
                Ok(hop) => hops.push(hop),
                Err(answer) => return Ok(Tunnelled::Answer(answer)),
            }
        }
        let host_hop = hops.pop().expect("the SSH host is the last hop");
        let plan = Plan {
            jump: hops.pop(),
            host: host_hop,
            timeout,
        };
        let ats: Vec<(String, u16)> = [plan.jump.as_ref(), Some(&plan.host)]
            .into_iter()
            .flatten()
            .map(|hop| (hop.host.clone(), hop.port))
            .collect();
        let tunnel = match desk_ssh::open(plan) {
            Ok(tunnel) => tunnel,
            Err(failure) => return Ok(Tunnelled::Answer(answer(&failure))),
        };
        // The person's yes is kept once the key took the tunnel through.
        let mut trusted = lock(&self.db_ssh_hosts);
        for (presented, (at, at_port)) in tunnel.presented().iter().zip(&ats) {
            let key = Trusted {
                algorithm: presented.algorithm.clone(),
                fingerprint: presented.fingerprint.clone(),
            };
            trusted.trust(caller, at, *at_port, key);
        }
        drop(trusted);
        let first = match tunnel.dial_blocking(host, port) {
            Ok(stream) => stream,
            Err(why) => {
                let failure = Failure {
                    which: Which::Host,
                    stage: Stage::Forward,
                    message: why.to_string(),
                    host_key: None,
                    passphrase: None,
                };
                return Ok(Tunnelled::Answer(answer(&failure)));
            }
        };
        let name = format!(
            "ssh {}",
            ats.last()
                .map(|(h, p)| format!("{h}:{p}"))
                .unwrap_or_default()
        );
        Ok(Tunnelled::Via(Arc::new(Via {
            tunnel,
            first: Mutex::new(Some(first)),
            name,
        })))
    }

    /// One hop's plan: its sign-in and its trust; an answer when its kept password is missing.
    fn hop(
        &self,
        caller: &str,
        which: Which,
        named: &Named<'_>,
    ) -> Result<Result<Hop, DbSshAnswer>, BridgeError> {
        let port = named.port()?;
        let invalid = |why: &str| error(ErrorCode::InvalidParams, format!("ssh: {why}"));
        let ways = [
            named.key_file.is_some(),
            named.agent,
            named.password.is_some() || named.password_ref.is_some(),
        ];
        if ways.iter().filter(|way| **way).count() != 1
            || (named.password.is_some() && named.password_ref.is_some())
        {
            return Err(invalid(
                "exactly one of keyFile, agent, password and passwordRef signs a hop in",
            ));
        }
        let auth = if let Some(path) = named.key_file {
            Auth::KeyFile {
                path: self
                    .key_path(path)
                    .ok_or_else(|| invalid("keyFile is a full path, starting with / or ~/"))?,
                passphrase: named.key_password.map(str::to_owned),
            }
        } else if named.agent {
            Auth::Agent { socket: None }
        } else if let Some(password) = named.password {
            Auth::Password(password.to_owned())
        } else {
            let name = named.password_ref.unwrap_or_default();
            let bound = Bound {
                host: named.host.to_owned(),
                port,
                user: named.user.to_owned(),
            };
            match self.db_kept_password(caller, name, &bound) {
                Some(password) => Auth::Password(password),
                None => {
                    let message = format!(
                        "{} {}:{port} needs {}'s password, and none is kept for it.",
                        capital(which.words()),
                        named.host,
                        named.user
                    );
                    return Ok(Err(DbSshAnswer {
                        hop: hop_name(which),
                        stage: DbSshStage::Auth,
                        message,
                        host_key: None,
                        key_password: None,
                        needs_password: Some(True),
                    }));
                }
            }
        };
        let trust = Trust {
            known: lock(&self.db_ssh_hosts).known(caller, named.host, port),
            accepted: named.host_key.map(str::to_owned),
        };
        Ok(Ok(Hop {
            host: named.host.to_owned(),
            port,
            user: named.user.to_owned(),
            auth,
            trust,
        }))
    }

    /// A key file's path: absolute, or under the home folder for `~/`.
    fn key_path(&self, path: &str) -> Option<PathBuf> {
        if let Some(rest) = path.strip_prefix("~/") {
            return Some(self.home().join(rest));
        }
        Path::new(path).is_absolute().then(|| PathBuf::from(path))
    }

    /// The caller's password kept under `name`, when it was kept for exactly `bound` (ADR 0311).
    fn db_kept_password(&self, caller: &str, name: &str, bound: &Bound) -> Option<String> {
        let passwords = self
            .db_passwords
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let (keychain, account) = passwords.lookup(caller, name, bound)?;
        drop(passwords);
        let text = keychain.get(&account).ok()??;
        secret_for(&text, bound)
    }

    pub(crate) fn db_host_keys_delete(
        &self,
        caller: &str,
        params: DbHostKeysDeleteParams,
    ) -> Answer {
        if crate::agents::agent_of(caller).is_some() {
            let why = "agents reach databases through the plugin's commands".to_owned();
            return Err(error(ErrorCode::PermissionDenied, why));
        }
        let port = u16::try_from(params.port.unwrap_or(22).max(1)).map_err(|_| {
            error(
                ErrorCode::InvalidParams,
                "an SSH port is 1 to 65535".to_owned(),
            )
        })?;
        lock(&self.db_ssh_hosts).forget(caller, &params.host, port);
        json(DbHostKeysDeleteResult {})
    }

    /// The plugin was removed: every host key it trusted goes.
    pub(crate) fn forget_db_ssh_hosts(&self, plugin: &str) {
        lock(&self.db_ssh_hosts).forget_plugin(plugin);
    }
}

/// The session's streams: the first, opened by db.open, then a channel of the tunnel each.
struct Via {
    tunnel: Tunnel,
    first: Mutex<Option<Stream>>,
    name: String,
}

impl Dial for Via {
    fn dial<'a>(&'a self, host: &'a str, port: u16) -> Dialled<'a> {
        Box::pin(async move {
            let first = self
                .first
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .take();
            let stream = match first {
                Some(stream) => stream,
                None => self.tunnel.dial(host, port).await?,
            };
            Ok(Box::new(stream) as Box<dyn desk_pg::Io>)
        })
    }

    fn name(&self) -> String {
        self.name.clone()
    }
}

fn hop_name(which: Which) -> DbSshHopName {
    match which {
        Which::Jump => DbSshHopName::Jump,
        Which::Host => DbSshHopName::Host,
    }
}

/// A failed hop as db.open answers it.
fn answer(failure: &Failure) -> DbSshAnswer {
    DbSshAnswer {
        hop: hop_name(failure.which),
        stage: match failure.stage {
            Stage::Connect => DbSshStage::Connect,
            Stage::HostKey => DbSshStage::HostKey,
            Stage::Auth => DbSshStage::Auth,
            Stage::Forward => DbSshStage::Forward,
        },
        message: failure.message.clone(),
        host_key: failure.host_key.as_ref().map(|key| DbSshHostKey {
            status: match key.status {
                KeyStatus::Unknown => DbSshHostKeyStatus::Unknown,
                KeyStatus::Changed => DbSshHostKeyStatus::Changed,
            },
            algorithm: key.algorithm.clone(),
            fingerprint: key.fingerprint.clone(),
            known: key.known.clone(),
        }),
        key_password: failure.passphrase.map(|p| match p {
            Passphrase::Needed => DbKeyPassword::Needed,
            Passphrase::Wrong => DbKeyPassword::Wrong,
        }),
        needs_password: None,
    }
}

fn capital(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

fn lock(hosts: &Mutex<DbSshHosts>) -> std::sync::MutexGuard<'_, DbSshHosts> {
    hosts
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
