//! Computer use in the app (ADR 0120, ADR 0123): the core gets desk-computer's OS driver and a
//! folder for the screenshots of agents' acts, and while an agent operates the computer the person
//! sees it and can stop it from any app. A small window above every app and Space shows
//! endue.computer's banner (`ui/banner.html`) with Stop, without taking the focus from the app in
//! front; the stop key (Escape held, or the chord `endue.computer.stop-key` names) is the desk's
//! only while an agent acts, so Escape stays every app's the rest of the time.

use std::path::Path;
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use desk_bridge::{BridgeEvent, BridgeRequest, BridgeResponse, ComputerActivityData};
use desk_core::Core;
use serde_json::json;
use tauri::{AppHandle, LogicalPosition, Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const LABEL: &str = "computer";
const PLUGIN: &str = "endue.computer";
const BANNER: (f64, f64) = (460.0, 52.0);
/// Below the menu bar, from the top of the main display.
const TOP: f64 = 34.0;
/// After an agent's last act the banner and the stop key stay this long.
const LINGER: Duration = Duration::from_secs(10);
/// Escape stops once it has been held this long; a tap stays the app's.
const HOLD: Duration = Duration::from_millis(500);
const DEFAULT_KEY: &str = "Escape";

/// What the watcher knows: the key the desk holds now, and when Escape went down.
#[derive(Default)]
struct Watch {
    key: Option<String>,
    pressed: Option<Instant>,
}

/// Give the core the OS driver, and show the banner and hold the stop key while agents act.
pub fn attach(core: &Arc<Core>, app: &AppHandle, data: &Path) {
    core.serve_computer(desk_computer::os(), Some(data.join("computer")));
    let events = core.events().subscribe();
    let (app, core) = (app.clone(), Arc::clone(core));
    let watch = Arc::new(Mutex::new(Watch::default()));
    let spawned = std::thread::Builder::new()
        .name("desk-computer".to_owned())
        .spawn(move || {
            let mut last: Option<Instant> = None;
            loop {
                match events.recv_timeout(Duration::from_secs(1)) {
                    Ok(BridgeEvent::ComputerActivity(activity)) => {
                        heard(&app, &core, &watch, &activity.data, &mut last);
                    }
                    Ok(_) => {}
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => return,
                }
                let idle = last.is_some_and(|at| at.elapsed() >= LINGER);
                if idle && !core.computer_stopped() {
                    last = None;
                    quiet(&app, &watch);
                }
            }
        });
    if let Err(why) = spawned {
        eprintln!("endue Desk: computer use is not watched ({why})");
    }
}

/// One `computer.activity`: the banner hears it, and an agent's act keeps the banner and the key.
fn heard(
    app: &AppHandle,
    core: &Arc<Core>,
    watch: &Arc<Mutex<Watch>>,
    data: &ComputerActivityData,
    last: &mut Option<Instant>,
) {
    use desk_bridge::ComputerActivityState as S;
    let value = serde_json::to_value(data).unwrap_or_default();
    let wanted = data.state == S::Stopped || data.agent.is_some();
    match app.get_webview_window(LABEL) {
        Some(window) => {
            let script = format!("window.deskBanner && window.deskBanner.show({value})");
            let _ = window.eval(script);
        }
        // Made once it is first needed, when endue.computer's files are installed; the page
        // reads this first activity from its URL.
        None if wanted => {
            if let Err(why) = banner(app, core, &value.to_string()) {
                eprintln!("endue Desk: the computer-use banner is unavailable ({why})");
            }
        }
        None => {}
    }
    match data.state {
        S::Resumed => {
            *last = None;
            quiet(app, watch);
        }
        S::Stopped => {
            *last = Some(Instant::now());
            show(app);
        }
        S::Acting | S::Done | S::Failed if data.agent.is_some() => {
            *last = Some(Instant::now());
            show(app);
            hold_key(app, core, watch);
        }
        _ => {}
    }
}

/// The banner's window: hidden until an agent acts, over every app and Space, never focused.
fn banner(app: &AppHandle, core: &Arc<Core>, first: &str) -> tauri::Result<()> {
    let url = if cfg!(windows) {
        format!("http://desk-plugin.localhost/{PLUGIN}/ui/banner.html")
    } else {
        format!("desk-plugin://localhost/{PLUGIN}/ui/banner.html")
    };
    let mut url = Url::parse(&url).map_err(|e| tauri::Error::Io(std::io::Error::other(e)))?;
    url.set_fragment(Some(first));
    let stopping = Arc::clone(core);
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::CustomProtocol(url))
        .title("Eris is using your computer")
        .inner_size(BANNER.0, BANNER.1)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .shadow(true)
        .focused(false)
        .accept_first_mouse(true)
        .visible(false)
        // Stop and Resume come back as a navigation the window never makes.
        .on_navigation(move |url| {
            let query = url.query().unwrap_or_default();
            if query.starts_with("stop") {
                stopping.stop_computer();
                false
            } else if query.starts_with("resume") {
                stopping.resume_computer();
                false
            } else {
                true
            }
        })
        .build()?;
    if let Ok(Some(monitor)) = app.primary_monitor() {
        let scale = monitor.scale_factor();
        let width = f64::from(monitor.size().width) / scale;
        window.set_position(LogicalPosition::new((width - BANNER.0) / 2.0, TOP))?;
    }
    Ok(())
}

/// Show the banner over the app in front without activating the desk.
fn show(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Some(window) = handle.get_webview_window(LABEL) else {
            return;
        };
        #[cfg(target_os = "macos")]
        if let Ok(ns_window) = window.ns_window() {
            mac::float(ns_window);
            mac::show_quietly(ns_window);
            return;
        }
        let _ = window.set_focusable(false);
        let _ = window.show();
    });
}

/// The agent went idle, or the person resumed: hide the banner, give the key back.
fn quiet(app: &AppHandle, watch: &Arc<Mutex<Watch>>) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.hide();
    }
    let mut held = watch.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(key) = held.key.take() {
        let _ = app.global_shortcut().unregister(key.as_str());
    }
    held.pressed = None;
}

/// Hold the stop key while an agent acts: Escape held for `HOLD`, any other chord at once.
fn hold_key(app: &AppHandle, core: &Arc<Core>, watch: &Arc<Mutex<Watch>>) {
    let mut held = watch.lock().unwrap_or_else(|e| e.into_inner());
    if held.key.is_some() {
        return;
    }
    let key = stop_key(core);
    let hold = matches!(key.to_ascii_lowercase().as_str(), "escape" | "esc");
    let (core, watch_key) = (Arc::clone(core), Arc::clone(watch));
    let result = app
        .global_shortcut()
        .on_shortcut(key.as_str(), move |_, _, event| {
            if !hold {
                if event.state == ShortcutState::Pressed {
                    core.stop_computer();
                }
                return;
            }
            let mut held = watch_key.lock().unwrap_or_else(|e| e.into_inner());
            match event.state {
                ShortcutState::Pressed if held.pressed.is_none() => {
                    let down = Instant::now();
                    held.pressed = Some(down);
                    let (core, watch) = (Arc::clone(&core), Arc::clone(&watch_key));
                    std::thread::spawn(move || {
                        std::thread::sleep(HOLD);
                        let still = watch.lock().unwrap_or_else(|e| e.into_inner()).pressed;
                        if still == Some(down) {
                            core.stop_computer();
                        }
                    });
                }
                ShortcutState::Pressed => {}
                ShortcutState::Released => held.pressed = None,
            }
        });
    match result {
        Ok(()) => held.key = Some(key.clone()),
        Err(why) => eprintln!("endue Desk: the stop key {key} is unavailable ({why}); use Stop"),
    }
    let label = if hold {
        "Hold Esc to stop".to_owned()
    } else {
        format!("{key} stops")
    };
    if let Some(window) = app.get_webview_window(LABEL) {
        let text = serde_json::to_string(&label).unwrap_or_default();
        let _ = window.eval(format!(
            "window.deskBanner && window.deskBanner.key({text})"
        ));
    }
}

/// `endue.computer.stop-key`, else Escape.
fn stop_key(core: &Core) -> String {
    let request = json!({ "id": 0, "method": "settings.get", "params": { "key": "stop-key" } });
    let Ok(request) = serde_json::from_value::<BridgeRequest>(request) else {
        return DEFAULT_KEY.to_owned();
    };
    let chosen = match core.handle(PLUGIN, request) {
        BridgeResponse::BridgeSuccess(ok) => ok.result["value"].as_str().map(str::to_owned),
        BridgeResponse::BridgeFailure(_) => None,
    };
    chosen
        .map(|key| key.trim().to_owned())
        .filter(|key| !key.is_empty())
        .unwrap_or_else(|| DEFAULT_KEY.to_owned())
}

/// The banner's window joins every Space and full-screen Space, and shows without taking the
/// focus. Allowed `unsafe` for the one pointer Tauri hands out, as `eris_window/macos.rs` is.
#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
mod mac {
    use std::ffi::c_void;

    use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};

    /// Call on the main thread, with a pointer Tauri handed out for a window still open.
    fn window<'a>(ns_window: *mut c_void) -> Option<&'a NSWindow> {
        // SAFETY: Tauri's `ns_window()` is the window's NSWindow, alive while the window is, and
        // both callers run on the main thread, inside `run_on_main_thread`.
        unsafe { ns_window.cast::<NSWindow>().as_ref() }
    }

    pub fn float(ns_window: *mut c_void) {
        if let Some(window) = window(ns_window) {
            let behavior = window.collectionBehavior()
                | NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::IgnoresCycle;
            window.setCollectionBehavior(behavior);
        }
    }

    pub fn show_quietly(ns_window: *mut c_void) {
        if let Some(window) = window(ns_window) {
            window.orderFrontRegardless();
        }
    }
}
