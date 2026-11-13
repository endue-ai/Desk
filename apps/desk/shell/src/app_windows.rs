//! Windows out of the canvas (#234, #235, ADR 0205): any window of one plugin can pop out of the
//! desk into an OS window of its own, a windowed CEF browser in a winit window (`Pane`), and dock
//! back. The window manager (`desk-wm`) keeps the window, its id, desktop and canvas place, and
//! says which are out; the compositor hands those to the web host (`web_host/app_surfaces.rs`),
//! which swaps the surface's off-screen browser for this one and back. The OS places, moves,
//! resizes, composites and focuses it; no desk code runs for a move, and its frame goes back to
//! `desk-wm` once it rests (`OutFrame`). An app window keeps its renderer while it is out, and its
//! page is hidden while the window is minimized or covered. Its bridge goes as an off-screen
//! surface's does: the page's `window.parent` is the shim (`web_host/shim.js`), its posts go up the
//! relay to the runtime's page and the runtime's come down to it (`relay.surface`), so
//! `desk:hello`, `desk:init`, calls, the theme, the sandbox and the guard work unchanged.
//!
//! Closing the OS window closes the window (`desk.windows.close`, asking about unsaved changes
//! first); Window > Move to Desk docks it. `DESK_APP_WINDOWS` (`switch.rs`) names the plugins whose
//! windows pop out the first time they show in a session (`on`: every app); unset or `off`, none
//! does. Each app opens where it was last, per display (`places.rs`).

mod client;
mod menu;
mod places;
mod registry;
mod switch;

use std::sync::mpsc::Sender;
use std::sync::{Arc, OnceLock};

use cef::{ImplBrowser, ImplBrowserHost};
use desk_web::sender::Role;
use desk_wm::Rect;
use desk_wm::interact::Op;
use serde_json::json;
use winit::dpi::{LogicalPosition, LogicalSize};
use winit::event::WindowEvent;
use winit::event_loop::ActiveEventLoop;
use winit::window::{Window, WindowId};

use crate::pane::Pane;
use crate::pump::Pump;
use crate::web_host::WebHost;
use crate::window::Shell;
pub use menu::{Item, removed};
pub use places::{Display, Kept, Place};
pub use registry::Registry;
pub use switch::{App, SWITCH, Switch, app, handed, handed_surface, know, switch};

/// The desk command that closes the runtime's window holding a plugin.
pub const CLOSE: &str = "desk.windows.close";
/// The desk command that docks a window out of the canvas back.
pub const DOCK: &str = "desk.windows.dock";
/// The runtime's channel for the desk commands the compositor's own chrome runs.
const RUN: &str = "desk://compositor-run";
/// An app window is never made smaller than this, in points.
pub const MIN: (f64, f64) = (320.0, 200.0);
/// Nor does it open smaller than this the first time: the runtime's window it stands in for may
/// be a crowded desk's small cell.
const OPENS: (f64, f64) = (720.0, 450.0);

/// An app window the shell holds: its pane, the window manager's window it is, and its plugin.
pub struct AppWindow {
    pub pane: Pane,
    pub window: String,
    pub plugin: String,
}

/// The app windows the shell holds.
pub type Windows = Registry<WindowId, AppWindow>;

/// An app window to open: its surface's host, the window manager's window, its plugin, its title
/// until its page names one, and its document.
#[derive(Clone, Debug)]
pub struct Open {
    pub surface: String,
    pub window: String,
    pub plugin: String,
    pub title: String,
    pub url: String,
}

/// Open the OS window of `ask` with its browser, whose bridge goes through `host`'s relay.
pub fn open(shell: &mut Shell, event_loop: &ActiveEventLoop, host: &WebHost, ask: Open) {
    if shell.quitting {
        return;
    }
    let attributes = Window::default_attributes()
        .with_title(ask.title.as_str())
        .with_min_inner_size(LogicalSize::new(MIN.0, MIN.1));
    // Where it was last, else as large as the runtime's window and at least `OPENS`.
    let attributes = match places::opening(event_loop, &ask.plugin, MIN) {
        Some(kept) => {
            let sized = attributes.with_inner_size(LogicalSize::new(kept.size.0, kept.size.1));
            match kept.at {
                Some((x, y)) => sized.with_position(LogicalPosition::new(x, y)),
                None => sized,
            }
        }
        None => {
            // As large as the window was on the canvas, at least `OPENS`.
            let size = (shell.compositor.as_ref()).and_then(|c| c.out_frame(&ask.window));
            let (w, h) = size.map_or(OPENS, |f| (f.w, f.h));
            attributes.with_inner_size(LogicalSize::new(w.max(OPENS.0), h.max(OPENS.1)))
        }
    };
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
        window: ask.window,
        plugin: ask.plugin,
    };
    if let Some(old) = shell.apps.insert(&ask.surface, window, id, held) {
        close_browser(shell, old);
    }
    if !wanted {
        close(shell, &ask.surface);
    }
}

/// The runtime closed the plugin's window (its surface's `destroy`): the OS window closes, its
/// place kept.
pub fn close(shell: &mut Shell, surface: &str) {
    if let Some(app) = shell.apps.get(surface) {
        places::keep(&app.plugin, &app.pane.window);
    }
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
            let run = json!({ "command": CLOSE, "args": { "window": app.window } });
            shell.desk.pages.emit(Role::Main, RUN, run);
        }
        WindowEvent::Focused(true) => {
            if let Some(host) = app.pane.host() {
                host.set_focus(1);
            }
            // The OS window has the keys: it is the desk's window in use.
            let window = app.window.clone();
            if let Some(compositor) = shell.compositor.as_mut() {
                compositor.run_window_op(&Op::Focus, &window);
            }
        }
        WindowEvent::Resized(size) => {
            app.pane.resized(*size);
            moved(&shell.desk.pump);
        }
        WindowEvent::Moved(_) => moved(&shell.desk.pump),
        // Minimized or wholly covered: its page is hidden, so it takes no frames (#147, #235).
        WindowEvent::Occluded(occluded) => {
            #[cfg(target_os = "macos")]
            if let Some(host) = app.pane.host() {
                crate::mac::set_hidden(host.window_handle(), *occluded);
            }
            let _ = occluded;
        }
        _ => {}
    }
}

/// An app window moved or resized: every app window's place is kept once they rest.
fn moved(pump: &Pump) {
    static NUDGE: OnceLock<Sender<()>> = OnceLock::new();
    let nudge = NUDGE.get_or_init(|| {
        let pump = pump.clone();
        crate::main_frame::debounce(move || pump.run(|shell, _| keep_all(shell)))
    });
    let _ = nudge.send(());
}

/// Keep where every open app window is now, and tell the window manager (`OutFrame`).
fn keep_all(shell: &mut Shell) {
    let mut frames = Vec::new();
    for surface in shell.apps.surfaces() {
        if let Some(app) = shell.apps.get(&surface) {
            places::keep(&app.plugin, &app.pane.window);
            if let Some(f) = crate::main_frame::frame_of(&app.pane.window) {
                frames.push((app.window.clone(), Rect::new(f.x, f.y, f.width, f.height)));
            }
        }
    }
    if let Some(compositor) = shell.compositor.as_mut() {
        for (window, frame) in frames {
            compositor.run_window_op(&Op::OutFrame { frame }, &window);
        }
    }
}

/// Bring the OS window of window `window`, out of the canvas, to the front with the keys: the desk
/// made it the window in use (`desk.windows.focus`, Eris, a reopen).
pub fn raise(shell: &mut Shell, window: &str) {
    let surface = (shell.apps.surfaces().into_iter())
        .find(|s| shell.apps.get(s).is_some_and(|app| app.window == window));
    if let Some(app) = surface.and_then(|s| shell.apps.get(&s)) {
        app.pane.window.set_minimized(false);
        app.pane.show_and_focus();
    }
}

/// Window > Move to Desk: the app window in front docks back to its place on the canvas.
pub fn dock_front(shell: &mut Shell) {
    let front = (shell.apps.surfaces().into_iter())
        .filter_map(|s| {
            shell
                .apps
                .get(&s)
                .map(|app| (app.pane.window.has_focus(), app.window.clone()))
        })
        .find_map(|(focused, window)| focused.then_some(window));
    // Through the runtime's command: it asks the plugin for its state before its page loads again.
    if let Some(window) = front {
        let run = json!({ "command": DOCK, "args": { "window": window } });
        shell.desk.pages.emit(Role::Main, RUN, run);
    }
}

/// The desk quits: every app window closes.
pub fn close_all(shell: &mut Shell) {
    for surface in shell.apps.surfaces() {
        close(shell, &surface);
    }
}

#[cfg(test)]
mod tests;
