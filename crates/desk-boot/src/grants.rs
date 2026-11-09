//! What the web runtime (caller `desk`) may do from the start, whichever shell hosts it.

use std::path::Path;

use desk_bridge::{
    AccountManagePermission, AgentsManagePermission, BrainAskPermission, BrainConversePermission,
    CmdInvokePermission, ConnectorManagePermission, FsReadPermission, FsWritePermission,
    MemoryReadPermission, MemoryWritePermission, PermManagePermission, Permission,
    PluginManagePermission, ShellOpenPermission, ShellScheme, StudioManagePermission,
    ThemeManagePermission, UpdateManagePermission, ViewManagePermission,
};
use desk_core::Core;

/// The caller id of the web runtime itself. Plugins call under their own ids.
pub const RUNTIME_CALLER: &str = "desk";

/// Grant the runtime what it needs, `data` being the app's data folder and `home` the person's.
pub fn grant_runtime(core: &Core, data: &Path, home: &Path) {
    // The runtime mounts plugins, so it may list and toggle them.
    core.grant(
        RUNTIME_CALLER,
        Permission::PluginManage(PluginManagePermission {
            permission: Default::default(),
        }),
    );
    // Keys run commands for the person, whoever provides them (ADR 0017).
    core.grant(
        RUNTIME_CALLER,
        Permission::CmdInvoke(CmdInvokePermission {
            permission: Default::default(),
            ids: vec!["*".to_owned()],
        }),
    );
    // desk.describe names who may run a command and describes grants (ADR 0075): it lists them, and
    // shows them only to callers that may list them too.
    core.grant(
        RUNTIME_CALLER,
        Permission::PermManage(PermManagePermission {
            permission: Default::default(),
        }),
    );
    // The shell talks to the brain and reads its agent directory as the runtime.
    core.grant(
        RUNTIME_CALLER,
        Permission::BrainConverse(BrainConversePermission {
            permission: Default::default(),
        }),
    );
    // The theme studio asks the brain for themes, each ask in a session of its own (ADR 0059).
    core.grant(
        RUNTIME_CALLER,
        Permission::BrainAsk(BrainAskPermission {
            permission: Default::default(),
        }),
    );
    // The desk's own screens read and keep Eris's memory for the person (ADR 0095).
    core.grant(
        RUNTIME_CALLER,
        Permission::MemoryRead(MemoryReadPermission {
            permission: Default::default(),
        }),
    );
    core.grant(
        RUNTIME_CALLER,
        Permission::MemoryWrite(MemoryWritePermission {
            permission: Default::default(),
        }),
    );
    // The runtime connects the person's connectors and keeps their views (ADR 0036).
    core.grant(
        RUNTIME_CALLER,
        Permission::ConnectorManage(ConnectorManagePermission {
            permission: Default::default(),
        }),
    );
    core.grant(
        RUNTIME_CALLER,
        Permission::ViewManage(ViewManagePermission {
            permission: Default::default(),
        }),
    );
    // The person's files in the desk folder (ADR 0079): the runtime reads and watches the folder,
    // and writes only the saved profiles and keys.yaml.
    core.grant(
        RUNTIME_CALLER,
        Permission::FsRead(FsReadPermission {
            permission: Default::default(),
            paths: vec!["~/.desk/**".to_owned()],
        }),
    );
    core.grant(
        RUNTIME_CALLER,
        Permission::FsWrite(FsWritePermission {
            permission: Default::default(),
            paths: vec![
                "~/.desk/profiles/**".to_owned(),
                "~/.desk/keys.yaml".to_owned(),
            ],
        }),
    );
    // The runtime shows the update and restarts into it when the person asks (ADR 0054).
    core.grant(
        RUNTIME_CALLER,
        Permission::UpdateManage(UpdateManagePermission {
            permission: Default::default(),
        }),
    );
    // The runtime signs the desk in to endue ID and out again (ADR 0089).
    core.grant(
        RUNTIME_CALLER,
        Permission::AccountManage(AccountManagePermission {
            permission: Default::default(),
        }),
    );
    // The shell lists the agent programs on this computer, imports their sessions and asks them for
    // work (ADR 0110).
    core.grant(
        RUNTIME_CALLER,
        Permission::AgentsManage(AgentsManagePermission {
            permission: Default::default(),
        }),
    );
    // Signed in, the agent bar lists the person's endue agents and spaces, and their windows read what
    // Studio shows of each (ADR 0129). The token stays in the core. "Open in endue.ai" opens https
    // links; the shell builds them only on endue.ai.
    core.grant(
        RUNTIME_CALLER,
        Permission::StudioManage(StudioManagePermission {
            permission: Default::default(),
        }),
    );
    core.grant(
        RUNTIME_CALLER,
        Permission::ShellOpen(ShellOpenPermission {
            permission: Default::default(),
            schemes: Some(vec![ShellScheme::Https]),
            paths: None,
        }),
    );
    // The person's themes (ADR 0058): the theme studio saves, imports, exports and removes them as
    // the runtime. `desk theme` does the same as the CLI, through desk_ipc::grants().
    core.grant(
        RUNTIME_CALLER,
        Permission::ThemeManage(ThemeManagePermission {
            permission: Default::default(),
        }),
    );
    // "Show in file manager" on a state file kept broken: the data folder and the views only.
    let views = home.join(".desk").join("views");
    let paths = [data, views.as_path()]
        .map(|dir| format!("{}/**", dir.display().to_string().replace('\\', "/")));
    core.grant(
        RUNTIME_CALLER,
        Permission::ShellOpen(ShellOpenPermission {
            permission: Default::default(),
            schemes: None,
            paths: Some(paths.to_vec()),
        }),
    );
}
