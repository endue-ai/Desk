//! `dialog.*` (#308): the OS's own open and save dialogs, which the shell shows attached to the desk
//! window. The core keeps no dialog: the shell hands it a [`Dialogs`] once it has a window, and each
//! call asks it. What the person chose is granted to the caller for the session, as any grant is
//! (`perm.list` shows it, `perm.revoke` ends it): `dialog.open` grants `fs:read` on each chosen file
//! (a folder: the folder and what lies inside it), `dialog.save` grants `fs:write` and `fs:read` on
//! the chosen path alone. Asking needs no permission, since the person's choice is the consent; only
//! the desk's page and installed plugins may ask (an agent, an MCP server, `cli` or the palette are
//! refused, and nothing is shown). A chosen path is granted only as the OS named it: valid UTF-8, no
//! `\\` outside Windows (a legal name character there that a bridge path cannot hold), already in
//! normal form (no `.`, `..`, empty segment or UNC prefix) and no `*` or `?`; under the home folder
//! it is answered and granted as `~/…`, the spelling the desk's buffers use (`policies/files.ts`).

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use desk_bridge::{
    DialogOpenKind, DialogOpenParams, DialogOpenResult, DialogSaveParams, DialogSaveResult,
    ErrorCode, FsReadPermission, FsReadPermissionPermission, FsWritePermission,
    FsWritePermissionPermission, GrantDuration, Permission,
};

use crate::agents::agent_of;
use crate::handler::{Answer, Core, error, json};

/// Why the shell could not show a dialog.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DialogError {
    /// There is no window to attach it to, or this OS has no such dialog.
    Unsupported(String),
    Failed(String),
}

/// Who asks, for the dialog's title: the plugin's name (or id), or the desk.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Asker {
    pub caller: String,
    pub name: String,
}

/// What shows the OS's dialogs: the shell. Called on the bridge's own threads, never on the shell's
/// event loop; each call returns once the person chose (`Some`) or cancelled (`None`).
pub trait Dialogs: Send + Sync {
    fn open(
        &self,
        asker: &Asker,
        params: &DialogOpenParams,
    ) -> Result<Option<Vec<PathBuf>>, DialogError>;
    fn save(
        &self,
        asker: &Asker,
        params: &DialogSaveParams,
    ) -> Result<Option<PathBuf>, DialogError>;
}

/// The shell's dialogs, once it gave them.
#[derive(Default)]
pub(crate) struct DialogHost(Mutex<Option<Arc<dyn Dialogs>>>);

/// A chosen path as the bridge writes it, or `None` for one that cannot be granted as the OS named it.
/// Under `home` it is written from `~`.
pub(crate) fn bridge_path(path: &Path, home: &Path) -> Option<String> {
    let text = path.to_str()?;
    let text = if cfg!(windows) {
        text.replace('\\', "/")
    } else if text.contains('\\') {
        return None;
    } else {
        text.to_owned()
    };
    let bytes = text.as_bytes();
    let drive = bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && &bytes[1..3] == b":/";
    let absolute = (text.starts_with('/') && !text.starts_with("//")) || drive;
    let normal = crate::paths::normalize(&text).is_some_and(|n| n == text);
    if !absolute || !normal || text.contains(['*', '?', '\0']) {
        return None;
    }
    let home = home.to_str()?.replace('\\', "/");
    let under = text
        .strip_prefix(home.trim_end_matches('/'))
        .filter(|rest| rest.starts_with('/'));
    Some(match under {
        Some(rest) => format!("~{rest}"),
        None => text,
    })
}

fn read(paths: Vec<String>) -> Permission {
    Permission::FsRead(FsReadPermission {
        permission: FsReadPermissionPermission::FsRead,
        paths,
    })
}

fn write(paths: Vec<String>) -> Permission {
    Permission::FsWrite(FsWritePermission {
        permission: FsWritePermissionPermission::FsWrite,
        paths,
    })
}

fn failed(why: DialogError) -> desk_bridge::BridgeError {
    match why {
        DialogError::Unsupported(message) => error(ErrorCode::Unsupported, message),
        DialogError::Failed(message) => error(ErrorCode::Internal, message),
    }
}

impl Core {
    /// Show dialogs through `dialogs` from now on (`None`: no window, `dialog.*` is `unsupported`).
    pub fn set_dialogs(&self, dialogs: Option<Arc<dyn Dialogs>>) {
        *self.dialogs.0.lock().unwrap_or_else(|e| e.into_inner()) = dialogs;
    }

    /// The shell's dialogs and who asks, for a caller that may ask the person through one: the desk's
    /// page or an installed plugin.
    fn dialogs_for(
        &self,
        caller: &str,
    ) -> Result<(Arc<dyn Dialogs>, Asker), desk_bridge::BridgeError> {
        let name = if caller == "desk" {
            Some("endue Desk".to_owned())
        } else if agent_of(caller).is_some() || caller.contains(':') {
            None
        } else {
            (self.registry().get(caller)).map(|info| {
                info.manifest
                    .and_then(|m| m.name)
                    .unwrap_or_else(|| caller.to_owned())
            })
        };
        let Some(name) = name else {
            let message = "only a plugin or the desk can ask the person through a dialog";
            return Err(error(ErrorCode::PermissionDenied, message.to_owned()));
        };
        let dialogs = self.dialogs.0.lock().unwrap_or_else(|e| e.into_inner());
        let dialogs = dialogs.clone().ok_or_else(|| {
            error(
                ErrorCode::Unsupported,
                "this desk has no window to show a dialog in".to_owned(),
            )
        })?;
        Ok((
            dialogs,
            Asker {
                caller: caller.to_owned(),
                name,
            },
        ))
    }

    pub(crate) fn dialog_open(&self, caller: &str, params: DialogOpenParams) -> Answer {
        let (dialogs, asker) = self.dialogs_for(caller)?;
        let folders = params.kind == Some(DialogOpenKind::Folders);
        let Some(chosen) = dialogs.open(&asker, &params).map_err(failed)? else {
            return json(DialogOpenResult {
                cancelled: true,
                paths: Vec::new(),
            });
        };
        let home = self.home();
        let paths: Vec<String> = chosen
            .iter()
            .filter_map(|path| bridge_path(path, home))
            .collect();
        if paths.is_empty() {
            return json(DialogOpenResult {
                cancelled: true,
                paths,
            });
        }
        let granted = if folders {
            paths
                .iter()
                .flat_map(|p| [p.clone(), format!("{p}/**")])
                .collect()
        } else {
            paths.clone()
        };
        self.grant_for(caller, read(granted), GrantDuration::Session);
        json(DialogOpenResult {
            cancelled: false,
            paths,
        })
    }

    pub(crate) fn dialog_save(&self, caller: &str, params: DialogSaveParams) -> Answer {
        let (dialogs, asker) = self.dialogs_for(caller)?;
        let chosen = dialogs.save(&asker, &params).map_err(failed)?;
        let Some(path) = chosen
            .as_deref()
            .and_then(|path| bridge_path(path, self.home()))
        else {
            return json(DialogSaveResult {
                cancelled: true,
                path: None,
            });
        };
        self.grant_for(caller, write(vec![path.clone()]), GrantDuration::Session);
        self.grant_for(caller, read(vec![path.clone()]), GrantDuration::Session);
        json(DialogSaveResult {
            cancelled: false,
            path: Some(path),
        })
    }
}
