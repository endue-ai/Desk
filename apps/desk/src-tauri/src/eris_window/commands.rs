//! The floating window's own commands (ADR 0121), as the app's inline plugin `eris-window`
//! (`plugin:eris-window|expand`), so they live here and not in the app's handler list; `build.rs`
//! declares them and `capabilities/eris.json` allows them to her window. Every other window is
//! refused.

use std::sync::atomic::Ordering::Relaxed;

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, WebviewWindow, Wry};

use super::machine::Event;
use super::{ErisWindow, LABEL, Shortcut, apply, frame, lock};

pub const PLUGIN: &str = "eris-window";

pub fn plugin() -> TauriPlugin<Wry> {
    Builder::new(PLUGIN)
        .invoke_handler(tauri::generate_handler![
            state,
            dismiss,
            expand,
            drag,
            reveal_main
        ])
        .build()
}

fn mine(window: &WebviewWindow) -> Result<(), String> {
    (window.label() == LABEL)
        .then_some(())
        .ok_or_else(|| "only the floating Eris window may".to_owned())
}

/// The shortcut in force and whether the desk holds it.
#[tauri::command]
fn state(window: WebviewWindow) -> Result<Shortcut, String> {
    mine(&window)?;
    let state = window.try_state::<ErisWindow>().ok_or("not set up")?;
    Ok(lock(&state.shortcut).clone())
}

/// Esc: she goes away until the desk is next in front or she is summoned.
#[tauri::command]
fn dismiss(window: WebviewWindow) -> Result<(), String> {
    mine(&window)?;
    let state = window.try_state::<ErisWindow>().ok_or("not set up")?;
    let effects = state.feed(Event::Dismiss);
    apply(window.app_handle(), effects);
    Ok(())
}

/// Grow for her composer, or fold back to her figure.
#[tauri::command]
fn expand(window: WebviewWindow, open: bool) -> Result<(), String> {
    mine(&window)?;
    frame::expand(&window, open).map_err(|e| e.to_string())
}

/// Move the window with the pointer.
#[tauri::command]
fn drag(window: WebviewWindow) -> Result<(), String> {
    mine(&window)?;
    if let Some(state) = window.try_state::<ErisWindow>() {
        state.dragged.store(true, Relaxed);
    }
    window.start_dragging().map_err(|e| e.to_string())
}

/// Bring the desk forward: an approval waits there.
#[tauri::command]
fn reveal_main(window: WebviewWindow) -> Result<(), String> {
    mine(&window)?;
    crate::palette::reveal_main(window.app_handle()).map_err(|e| e.to_string())
}
