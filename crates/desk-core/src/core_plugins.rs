//! The plugin side of `Core`: install, list, enable, serve files, and report changes on the bus. A
//! plugin turned off unloads: its commands, waiting requests and subscriptions go with it, and a
//! connector's instances pause.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, MutexGuard};

use desk_bridge::{
    BridgeEvent, ErrorCode, EventName, Permission, PluginChange, PluginChangedData,
    PluginChangedEvent, PluginInfo, PluginListParams, PluginListResult, PluginManagePermission,
    PluginSetEnabledParams, PluginSetEnabledResult, PluginStatus,
};

use crate::handler::{Answer, Core, error, json};
use crate::perm::Target;
use crate::plugins::PluginRegistry;
use crate::watch::{self, PluginWatcher};

impl Core {
    /// Remember enabled flags in `store` (a JSON file in the app's data folder).
    pub fn with_plugin_store(self, store: PathBuf) -> Self {
        *self.registry() = PluginRegistry::new(Some(store));
        self
    }

    /// Install the plugin in `dir`. Built-in plugins get the permissions their manifest declares;
    /// others ask with perm.request like anyone else. Plugins init.yaml disables start disabled.
    pub fn install_plugin(&self, dir: &Path, built_in: bool) -> PluginInfo {
        let mut info = self.registry().install(dir, built_in);
        if self.init_disables(&info.id) {
            info = self.registry().hold_off(&info.id).unwrap_or(info);
        }
        if built_in && info.status == PluginStatus::Ready {
            let permissions = info
                .manifest
                .as_ref()
                .and_then(|m| m.permissions.clone())
                .unwrap_or_default();
            for permission in permissions {
                self.grant(&info.id, permission);
            }
        }
        self.plugin_changed(&info.id, PluginChange::Installed, info.revision);
        self.install_connector(&info);
        info
    }

    /// Install every plugin folder under `parent`.
    pub fn install_plugins_in(&self, parent: &Path, built_in: bool) -> Vec<PluginInfo> {
        let mut dirs: Vec<PathBuf> = std::fs::read_dir(parent)
            .map(|read| read.flatten().map(|entry| entry.path()).collect())
            .unwrap_or_default();
        dirs.retain(|dir| dir.join("plugin.json").is_file());
        dirs.sort();
        dirs.iter()
            .map(|dir| self.install_plugin(dir, built_in))
            .collect()
    }

    pub fn plugins(&self) -> Vec<PluginInfo> {
        self.registry().list()
    }

    /// A file of an installed plugin, for the app's plugin URL scheme.
    pub fn plugin_file(&self, id: &str, path: &str) -> io::Result<Vec<u8>> {
        self.registry().file(id, path)
    }

    /// Start hot reload for the plugins installed so far.
    pub fn watch_plugins(self: &Arc<Self>) -> io::Result<PluginWatcher> {
        watch::start(self)
    }

    pub(crate) fn plugin_folders(&self) -> Vec<(String, PathBuf)> {
        self.registry().folders()
    }

    pub(crate) fn plugin_files_changed(&self, id: &str) {
        let refreshed = self.registry().refresh(id);
        if let Some(info) = refreshed {
            self.plugin_changed(&info.id, PluginChange::Updated, info.revision);
            self.reload_connector(&info.id);
        }
    }

    pub(crate) fn plugin_list(&self, caller: &str, params: PluginListParams) -> Answer {
        self.authorize_manage(caller, params.scope)?;
        json(PluginListResult {
            plugins: self.plugins(),
        })
    }

    pub(crate) fn plugin_set_enabled(
        &self,
        caller: &str,
        params: PluginSetEnabledParams,
    ) -> Answer {
        self.authorize_manage(caller, params.scope)?;
        let info = self
            .registry()
            .set_enabled(&params.plugin, params.enabled)
            .ok_or_else(|| error(ErrorCode::NotFound, format!("no plugin {}", params.plugin)))?;
        let change = if params.enabled {
            PluginChange::Enabled
        } else {
            self.unloaded(&info.id);
            PluginChange::Disabled
        };
        self.plugin_changed(&info.id, change, info.revision);
        // A connector's instances pause while its plugin is off, and resume when it is on.
        self.connector_toggled(&info.id);
        json(PluginSetEnabledResult { plugin: info })
    }

    /// Whether `caller` can act: callers that are not plugins always can, plugins while enabled and
    /// ready.
    pub(crate) fn running(&self, caller: &str) -> bool {
        self.registry()
            .get(caller)
            .is_none_or(|info| info.enabled && info.status == PluginStatus::Ready)
    }

    /// A plugin that stops provides no commands, waits for no answer and hears no subscriptions; if
    /// it was the last perm:manage holder, the Prompter decides what waits.
    fn unloaded(&self, id: &str) {
        self.drop_provider(id);
        self.withdraw_prompts(id);
        self.drop_subscriber(id);
        self.drop_data(id);
        self.settle_unheard();
    }

    fn authorize_manage(
        &self,
        caller: &str,
        scope: PluginManagePermission,
    ) -> Result<(), desk_bridge::BridgeError> {
        self.check(caller, &Permission::PluginManage(scope), &Target::None)
    }

    /// `plugin.changed` for the plugin:manage holders and the callers subscribed to it.
    fn plugin_changed(&self, id: &str, change: PluginChange, revision: u64) {
        let managers = self.holders(&Permission::PluginManage(PluginManagePermission {
            permission: Default::default(),
        }));
        let to = self.recipients(EventName::PluginChanged, managers);
        self.events().publish_to(
            to,
            BridgeEvent::PluginChanged(PluginChangedEvent {
                event: Default::default(),
                data: PluginChangedData {
                    plugin: id.to_owned(),
                    change,
                    revision,
                },
            }),
        );
    }

    fn registry(&self) -> MutexGuard<'_, PluginRegistry> {
        self.plugins
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}
