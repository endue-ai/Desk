//! Which plugins open in an OS window of their own (#234, #235): the switch `DESK_APP_WINDOWS` and,
//! when it says `on`, the plugins' manifests. An app is a `ui` plugin whose surface is placed
//! `center` or `floating`; the other places (`left`, `right`, `bottom`, `overlay`) stay the desk's.
//! The answers come from the core's plugin registry and are kept for the session, as the
//! compositor asks on every plan.

use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex, OnceLock};

use desk_bridge::{PluginKind, PluginManifest, SurfacePlacement};
use desk_core::Core;

pub use desk_wm::plugin_of;

/// The switch's environment variable.
pub const SWITCH: &str = "DESK_APP_WINDOWS";

/// What the switch says.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum Switch {
    /// No plugin opens in an OS window of its own: the desk draws them all.
    #[default]
    Off,
    /// Every app (a `ui` plugin placed `center` or `floating`) does.
    Apps,
    /// These plugins do, by id, whatever their manifests say.
    Only(BTreeSet<String>),
}

impl Switch {
    /// The switch's value: `on` (or `apps`) for every app, `off` or nothing for none, else plugin
    /// ids separated by commas, spaces around them and empty ones ignored.
    pub fn parse(value: Option<&str>) -> Switch {
        let value = value.unwrap_or_default().trim();
        match value.to_ascii_lowercase().as_str() {
            "" | "off" | "0" | "false" | "no" => return Switch::Off,
            "on" | "apps" | "1" | "true" | "yes" => return Switch::Apps,
            _ => {}
        }
        let ids = value.split(',').map(str::trim).filter(|id| !id.is_empty());
        let ids: BTreeSet<String> = ids.map(str::to_owned).collect();
        if ids.is_empty() {
            Switch::Off
        } else {
            Switch::Only(ids)
        }
    }

    /// Whether any plugin may open in an OS window of its own.
    pub fn is_on(&self) -> bool {
        *self != Switch::Off
    }

    /// Whether plugin `plugin`'s surface `view` (any of its surfaces when `None`) opens in an OS
    /// window of its own, its manifest read by `manifest` when the switch needs it.
    pub fn wants(
        &self,
        plugin: &str,
        view: Option<&str>,
        manifest: impl FnOnce() -> Option<App>,
    ) -> bool {
        match self {
            Switch::Off => false,
            Switch::Only(ids) => ids.contains(plugin),
            Switch::Apps => manifest().is_some_and(|app| app.opens(view)),
        }
    }
}

/// What a plugin's manifest says about its windows.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct App {
    /// A `ui` plugin.
    pub ui: bool,
    /// Its name, for its window's title until its page names one.
    pub name: String,
    /// Its surfaces by id, and whether each is placed `center` or `floating`.
    pub surfaces: Vec<(String, bool)>,
}

impl App {
    pub fn of(manifest: &PluginManifest) -> App {
        let placed = |p: SurfacePlacement| {
            matches!(p, SurfacePlacement::Center | SurfacePlacement::Floating)
        };
        App {
            ui: manifest.kind == PluginKind::Ui,
            name: (manifest.name.clone()).unwrap_or_else(|| manifest.id.clone()),
            surfaces: (manifest.surfaces.iter().flatten())
                .map(|s| (s.id.clone(), placed(s.placement)))
                .collect(),
        }
    }

    /// Whether surface `view` (any surface when `None`) is an app's window.
    pub fn opens(&self, view: Option<&str>) -> bool {
        self.ui
            && (self.surfaces.iter())
                .any(|(id, placed)| *placed && view.is_none_or(|view| view == id))
    }
}

/// The switch as this desk started with it, and the manifests it read.
struct Known {
    switch: Switch,
    core: OnceLock<Arc<Core>>,
    apps: Mutex<HashMap<String, Option<App>>>,
}

fn known() -> &'static Known {
    static KNOWN: OnceLock<Known> = OnceLock::new();
    KNOWN.get_or_init(|| Known {
        switch: Switch::parse(std::env::var(SWITCH).ok().as_deref()),
        core: OnceLock::new(),
        apps: Mutex::default(),
    })
}

/// The switch, as this desk started with it.
pub fn switch() -> &'static Switch {
    &known().switch
}

/// The core whose plugin registry says which plugins are apps. Call once it booted.
pub fn know(core: &Arc<Core>) {
    let _ = known().core.set(Arc::clone(core));
}

/// What plugin `plugin`'s manifest says, read once a session.
pub fn app(plugin: &str) -> Option<App> {
    let known = known();
    let mut apps = known.apps.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(app) = apps.get(plugin) {
        return app.clone();
    }
    let core = known.core.get()?;
    let app = (core.plugins().into_iter())
        .find(|p| p.id == plugin)
        .and_then(|p| p.manifest.as_ref().map(App::of));
    apps.insert(plugin.to_owned(), app.clone());
    app
}

/// Whether window `key`'s plugin's windows are OS windows of their own (any window of a plugin,
/// ADR 0212).
pub fn handed(key: &str) -> bool {
    let plugin = plugin_of(key);
    switch().wants(plugin, None, || app(plugin))
}

/// Whether window `key`'s plugin's surface `view` opens in an OS window of its own.
pub fn handed_surface(key: &str, view: &str) -> bool {
    let plugin = plugin_of(key);
    switch().wants(plugin, Some(view), || app(plugin))
}
