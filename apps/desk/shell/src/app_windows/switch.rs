//! Which plugins open in an OS window of their own (#234, #235): the plugins' manifests and the
//! switch `DESK_APP_WINDOWS`. An app is a `ui` plugin whose surface is placed `center` or
//! `floating`; the other places (`left`, `right`, `bottom`, `overlay`) stay the desk's. An app whose
//! first surface says `window.opens: "out"` opens out (ADR 0226); the switch adds the plugins it
//! names or, with `on`, every app, and with `off` keeps every window on the canvas.
//! The answers come from the core's plugin registry and are kept for the session, as the
//! compositor asks on every plan.

use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex, OnceLock};

use desk_bridge::{PluginKind, PluginManifest, SurfaceOpens, SurfacePlacement, SurfaceWindow};
use desk_core::Core;

pub use desk_wm::plugin_of;

/// The switch's environment variable.
pub const SWITCH: &str = "DESK_APP_WINDOWS";

/// What the switch says.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum Switch {
    /// Unset: the apps whose manifests say they open out do.
    #[default]
    Manifests,
    /// No plugin opens in an OS window of its own: the desk draws them all.
    Off,
    /// Every app (a `ui` plugin placed `center` or `floating`) does.
    Apps,
    /// These plugins do, by id, whatever their manifests say, and the apps that say so.
    Only(BTreeSet<String>),
}

impl Switch {
    /// The switch's value: `on` (or `apps`) for every app, `off` for none, nothing for what the
    /// manifests say, else plugin ids separated by commas, spaces around them and empty ones
    /// ignored.
    pub fn parse(value: Option<&str>) -> Switch {
        let value = value.unwrap_or_default().trim();
        match value.to_ascii_lowercase().as_str() {
            "" => return Switch::Manifests,
            "off" | "0" | "false" | "no" => return Switch::Off,
            "on" | "apps" | "1" | "true" | "yes" => return Switch::Apps,
            _ => {}
        }
        let ids = value.split(',').map(str::trim).filter(|id| !id.is_empty());
        let ids: BTreeSet<String> = ids.map(str::to_owned).collect();
        if ids.is_empty() {
            Switch::Manifests
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
            Switch::Manifests => manifest().is_some_and(|app| app.opens_out(view)),
            Switch::Only(ids) => {
                ids.contains(plugin) || manifest().is_some_and(|app| app.opens_out(view))
            }
            Switch::Apps => manifest().is_some_and(|app| app.opens(view)),
        }
    }
}

/// What a plugin's manifest says about its windows.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct App {
    /// A `ui` plugin.
    pub ui: bool,
    /// Its name, for its window's title until its page names one.
    pub name: String,
    /// Its surfaces by id, and whether each is placed `center` or `floating`.
    pub surfaces: Vec<(String, bool)>,
    /// What its first surface asks of its window (ADR 0226).
    pub window: Option<SurfaceWindow>,
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
            window: (manifest.surfaces.iter().flatten().next()).and_then(|s| s.window.clone()),
        }
    }

    /// Whether surface `view` (any surface when `None`) is an app's window.
    pub fn opens(&self, view: Option<&str>) -> bool {
        self.ui
            && (self.surfaces.iter())
                .any(|(id, placed)| *placed && view.is_none_or(|view| view == id))
    }

    /// Whether its first surface is an app's window that its manifest opens out of the canvas,
    /// and `view` (when named) is that surface.
    pub fn opens_out(&self, view: Option<&str>) -> bool {
        let Some((first, _)) = self.surfaces.first() else {
            return false;
        };
        let out = (self.window.as_ref()).is_some_and(|w| w.opens == Some(SurfaceOpens::Out));
        out && self.opens(Some(first)) && view.is_none_or(|view| view == first)
    }

    /// Its window's hints, for its OS window.
    pub fn hints(&self) -> super::Hints {
        super::Hints::of(self.window.as_ref())
    }
}

/// The switch as this desk started with it, and the manifests it read.
struct Known {
    switch: Switch,
    core: OnceLock<Arc<Core>>,
    apps: Mutex<HashMap<String, Option<App>>>,
    /// Whether each plugin's windows open out, as `handed` answered: the compositor asks on
    /// every look, so the answer is kept apart from the manifest it came from.
    handed: Mutex<HashMap<String, bool>>,
}

fn known() -> &'static Known {
    static KNOWN: OnceLock<Known> = OnceLock::new();
    KNOWN.get_or_init(|| Known {
        switch: Switch::parse(std::env::var(SWITCH).ok().as_deref()),
        core: OnceLock::new(),
        apps: Mutex::default(),
        handed: Mutex::default(),
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
    let known = known();
    if !known.switch.is_on() {
        return false;
    }
    let plugin = plugin_of(key);
    let mut handed = known.handed.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(yes) = handed.get(plugin) {
        return *yes;
    }
    let yes = known.switch.wants(plugin, None, || app(plugin));
    // Before the core is known no manifest is read: the answer is not kept.
    if known.core.get().is_some() {
        handed.insert(plugin.to_owned(), yes);
    }
    yes
}

/// Whether window `key`'s plugin's surface `view` opens in an OS window of its own.
pub fn handed_surface(key: &str, view: &str) -> bool {
    let plugin = plugin_of(key);
    switch().wants(plugin, Some(view), || app(plugin))
}
