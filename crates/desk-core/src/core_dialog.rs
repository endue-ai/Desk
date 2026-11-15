//! `dialog.*` (#308): the OS's own open and save dialogs, which the shell shows attached to the desk
//! window. The core keeps no dialog: the shell hands it a [`Dialogs`] once it has a window, and each
//! call asks it. What the person chose is granted to the caller for the session, as any grant is
//! (`perm.list` shows it, `perm.revoke` ends it): `dialog.open` grants `fs:read` on each chosen file
//! (a folder: the folder and what lies inside it), `dialog.save` grants `fs:write` and `fs:read` on
//! the chosen path alone. Asking needs no permission, since the person's choice is the consent; an
//! agent's or an MCP server's call is refused, and nothing is shown for it.

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

/// What shows the OS's dialogs: the shell. Called on the bridge's own threads, never on the shell's
/// event loop; each call returns once the person chose (`Some`) or cancelled (`None`).
pub trait Dialogs: Send + Sync {
    fn open(&self, params: &DialogOpenParams) -> Result<Option<Vec<PathBuf>>, DialogError>;
    fn save(&self, params: &DialogSaveParams) -> Result<Option<PathBuf>, DialogError>;
}

/// The shell's dialogs, once it gave them.
#[derive(Default)]
pub(crate) struct DialogHost(Mutex<Option<Arc<dyn Dialogs>>>);

/// A chosen path as the bridge writes paths: forward slashes. `None` for one a grant would read as
/// a pattern (`*`, `?`), or that is not absolute.
fn bridge_path(path: &Path) -> Option<String> {
    let path = path.to_string_lossy().replace('\\', "/");
    let absolute = path.starts_with('/') || path.as_bytes().get(1) == Some(&b':');
    (absolute && !path.contains(['*', '?'])).then_some(path)
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

    /// The shell's dialogs, for a caller that may ask the person through one.
    fn dialogs_for(&self, caller: &str) -> Result<Arc<dyn Dialogs>, desk_bridge::BridgeError> {
        if agent_of(caller).is_some() || caller.starts_with("mcp:") {
            let message = "only a plugin or the desk can ask the person through a dialog";
            return Err(error(ErrorCode::PermissionDenied, message.to_owned()));
        }
        let dialogs = self.dialogs.0.lock().unwrap_or_else(|e| e.into_inner());
        dialogs.clone().ok_or_else(|| {
            error(
                ErrorCode::Unsupported,
                "this desk has no window to show a dialog in".to_owned(),
            )
        })
    }

    pub(crate) fn dialog_open(&self, caller: &str, params: DialogOpenParams) -> Answer {
        let dialogs = self.dialogs_for(caller)?;
        let folders = params.kind == Some(DialogOpenKind::Folders);
        let Some(chosen) = dialogs.open(&params).map_err(failed)? else {
            return json(DialogOpenResult {
                cancelled: true,
                paths: Vec::new(),
            });
        };
        let paths: Vec<String> = chosen.iter().filter_map(|path| bridge_path(path)).collect();
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
        let dialogs = self.dialogs_for(caller)?;
        let chosen = dialogs.save(&params).map_err(failed)?;
        let Some(path) = chosen.as_deref().and_then(bridge_path) else {
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
