//! App windows (#234, step 1 of #232, ADR 0203): a plugin the switch names shows its surface in an
//! OS window of its own, a windowed CEF browser in a winit window (`Pane`), instead of an
//! off-screen surface the compositor draws. The OS places, moves, resizes, composites and focuses
//! it; no desk code runs for a move.
//!
//! The switch is `DESK_APP_WINDOWS`, a comma-separated list of plugin ids (`endue.terminal`); unset,
//! nothing changes. The surface's lifecycle still comes from the window manager (`desk-wm`): its
//! `create` opens the OS window at the surface's document (`web_host/app_surfaces.rs`), its
//! `destroy` closes it, and the rest (resize, hide, sleep, wake, pace) is the OS window's own
//! business, so it is dropped. The compositor draws nothing for the runtime's window that holds
//! the plugin (`drawn`) and routes no input there. Its bridge goes as an off-screen surface's does:
//! the page's `window.parent` is the shim (`web_host/shim.js`), its posts go up the relay to the
//! runtime's page and the runtime's come down to it (`relay.surface`), so `desk:hello`,
//! `desk:init`, calls, the theme, the sandbox and the guard work unchanged. Closing the OS window
//! asks the runtime to close the plugin's window (`desk.windows.close`); the runtime's close, a
//! `destroy`, closes the OS window.

mod client;
mod registry;

use std::collections::BTreeSet;
use std::sync::{Arc, OnceLock};

use cef::{ImplBrowser, ImplBrowserHost};
use desk_web::sender::Role;
use desk_wm::Plan;
use serde_json::json;
use winit::dpi::LogicalSize;
use winit::event::WindowEvent;
use winit::event_loop::ActiveEventLoop;
use winit::window::{Window, WindowId};

use crate::pane::Pane;
use crate::web_host::WebHost;
use crate::window::Shell;
pub use registry::Registry;

/// The switch's environment variable.
pub const SWITCH: &str = "DESK_APP_WINDOWS";
/// The desk command that closes the runtime's window holding a plugin.
pub const CLOSE: &str = "desk.windows.close";
/// The runtime's channel for the desk commands the compositor's own chrome runs.
const RUN: &str = "desk://compositor-run";
/// An app window is never made smaller than this, in points.
const MIN: (f64, f64) = (320.0, 200.0);
/// Nor does it open smaller than this: the runtime's window it stands in for may be a crowded
/// desk's small cell.
const OPENS: (f64, f64) = (720.0, 450.0);

/// The plugins whose surfaces open in an OS window of their own.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Switch(BTreeSet<String>);

impl Switch {
    /// The switch's value: plugin ids separated by commas, spaces around them and empty ones
    /// ignored; unset or empty, the switch is off.
    pub fn parse(value: Option<&str>) -> Switch {
        let ids = value.unwrap_or_default().split(',').map(str::trim);
        Switch(ids.filter(|id| !id.is_empty()).map(str::to_owned).collect())
    }

    /// Whether plugin `plugin`'s surface opens in an OS window of its own.
    pub fn has(&self, plugin: &str) -> bool {
        self.0.contains(plugin)
    }

    /// Whether any plugin is named.
    pub fn is_on(&self) -> bool {
        !self.0.is_empty()
    }
}

/// The switch, as this desk started with it.
pub fn switch() -> &'static Switch {
    static ON: OnceLock<Switch> = OnceLock::new();
    ON.get_or_init(|| Switch::parse(std::env::var(SWITCH).ok().as_deref()))
}

/// The plan the compositor draws and routes input by, when it differs from `plan`: without the
/// runtime's windows that show a plugin the switch names, which are in OS windows of their own.
/// The surfaces' lifecycle and the live budget keep reading `plan`, where those windows are.
pub fn drawn(plan: &Plan, switch: &Switch) -> Option<Plan> {
    let handed = |w: &desk_wm::HostWindow| {
        (w.panes.iter()).any(|p| p.plugin.as_deref().is_some_and(|id| switch.has(id)))
    };
    if !switch.is_on() || !plan.windows.iter().any(handed) {
        return None;
    }
    let mut drawn = plan.clone();
    drawn.windows.retain(|w| !handed(w));
    Some(drawn)
}

/// An app window the shell holds: its pane and the plugin it shows.
pub struct AppWindow {
    pub pane: Pane,
    pub plugin: String,
}

/// The app windows the shell holds.
pub type Windows = Registry<WindowId, AppWindow>;

/// An app window to open: its surface's host, its plugin, its document and its size in points.
#[derive(Clone, Debug)]
pub struct Open {
    pub surface: String,
    pub plugin: String,
    pub url: String,
    pub size: (u32, u32),
}

/// Open the OS window of `ask` with its browser, whose bridge goes through `host`'s relay.
pub fn open(shell: &mut Shell, event_loop: &ActiveEventLoop, host: &WebHost, ask: Open) {
    if shell.quitting {
        return;
    }
    let (w, h) = (f64::from(ask.size.0), f64::from(ask.size.1));
    let attributes = Window::default_attributes()
        .with_title(ask.plugin.as_str())
        .with_inner_size(LogicalSize::new(w.max(OPENS.0), h.max(OPENS.1)))
        .with_min_inner_size(LogicalSize::new(MIN.0, MIN.1));
    let pump = shell.desk.pump.clone();
    let client = client::client(host.clone(), &ask.surface, pump, Arc::clone(&shell.desk));
    let pane = match Pane::open(event_loop, false, attributes, &ask.url, client) {
        Ok(pane) => pane,
        Err(why) => {
            eprintln!("endue Desk: {}'s window did not open ({why})", ask.plugin);
            return;
        }
    };
    let browser = pane.browser.clone();
    let id = browser.as_ref().map(ImplBrowser::identifier);
    // Destroyed while it opened: it goes as soon as it is held.
    let wanted = host.app_opened(&ask.surface, browser);
    let window = pane.window.id();
    if wanted {
        pane.show_and_focus();
    }
    let held = AppWindow {
        pane,
        plugin: ask.plugin,
    };
    if let Some(old) = shell.apps.insert(&ask.surface, window, id, held) {
        close_browser(shell, old);
    }
    if !wanted {
        close(shell, &ask.surface);
    }
}

/// The runtime closed the plugin's window (its surface's `destroy`): the OS window closes.
pub fn close(shell: &mut Shell, surface: &str) {
    if let Some(browser) = shell.apps.ask_close(surface) {
        close_browser(shell, browser);
    }
}

fn close_browser(shell: &Shell, browser: i32) {
    if let Some(app) = shell.apps.going(browser) {
        app.pane.window.set_visible(false);
        app.pane.close(true);
    }
}

/// Browser `browser` agreed to close (`DoClose`): its window lets go of its view and goes, which
/// destroys the browser (`OnBeforeClose` follows).
pub fn agreed(shell: &mut Shell, browser: i32) {
    if let Some(app) = shell.apps.agreed(browser) {
        app.pane.let_go();
    }
}

/// Browser `browser` is gone.
pub fn closed(shell: &mut Shell, browser: i32) {
    drop(shell.apps.closed(browser));
}

/// The page of surface `surface` loaded: it has the keys if its window has the focus.
pub fn loaded(shell: &mut Shell, surface: &str) {
    if let Some(app) = shell.apps.get(surface)
        && app.pane.window.has_focus()
        && let Some(host) = app.pane.host()
    {
        host.set_focus(1);
    }
}

/// The page of surface `surface` has a new title: its window's.
pub fn titled(shell: &mut Shell, surface: &str, title: &str) {
    if let Some(app) = shell.apps.get(surface)
        && !title.trim().is_empty()
    {
        app.pane.window.set_title(title);
    }
}

/// An event of OS window `id`, which is none of the shell's own windows: an app window's, if any.
pub fn window_event(shell: &mut Shell, id: WindowId, event: &WindowEvent) {
    let Some(app) = (shell.apps.surface_of(id)).and_then(|s| shell.apps.get(s)) else {
        return;
    };
    match event {
        WindowEvent::CloseRequested if !shell.quitting => {
            let plugin = app.plugin.clone();
            ask_runtime_to_close(shell, &plugin);
        }
        WindowEvent::Focused(true) => {
            if let Some(host) = app.pane.host() {
                host.set_focus(1);
            }
        }
        WindowEvent::Resized(size) => app.pane.resized(*size),
        _ => {}
    }
}

/// The person closed plugin `plugin`'s OS window: the runtime closes its window (asking about
/// unsaved changes first), whose `destroy` closes the OS window.
fn ask_runtime_to_close(shell: &Shell, plugin: &str) {
    let window = shell
        .compositor
        .as_ref()
        .and_then(|c| c.window_holding(plugin));
    let Some(window) = window else {
        eprintln!("endue Desk: no window of the desk's holds {plugin}");
        return;
    };
    let run = json!({ "command": CLOSE, "args": { "window": window } });
    shell.desk.pages.emit(Role::Main, RUN, run);
}

/// The desk quits: every app window closes.
pub fn close_all(shell: &mut Shell) {
    for surface in shell.apps.surfaces() {
        close(shell, &surface);
    }
}

#[cfg(test)]
mod tests;
