//! The floating window itself (ADR 0121): shown on the display the person is using at her spot
//! there, quietly or summoned; hidden; grown for her composer and folded back; her spot kept. Runs on
//! the event loop's thread. Ported from the Tauri shell.

use std::path::Path;
use std::sync::atomic::Ordering::Relaxed;

use desk_web::sender::Role;
use serde_json::Value;
use winit::dpi::LogicalSize;

use super::place::resize;
use super::{ErisWindow, FIGURE, MARGIN, OPEN, lock};
use crate::displays::{self, display, physical, rect_of};
use crate::float;
use crate::window::Shell;

pub(super) fn show(shell: &mut Shell, state: &ErisWindow, summon: bool) {
    let Some(pane) = shell.pane(Role::Eris) else {
        return;
    };
    if !pane.visible() {
        // Folded, on the display the person is using, at her spot there.
        state.open.store(false, Relaxed);
        *lock(&state.folded) = None;
        match displays::cursor_monitor(&pane.window) {
            Some(monitor) => {
                let scale = monitor.scale_factor();
                let margin = (MARGIN * scale).round() as u32;
                let figure = physical(FIGURE, scale);
                let at = lock(&state.positions).place(&display(&monitor), figure, margin);
                displays::place(&pane.window, at, scale);
            }
            None => {
                let _ = pane
                    .window
                    .request_inner_size(LogicalSize::new(FIGURE.0, FIGURE.1));
            }
        }
    }
    if !summon {
        // Shown without taking the focus from the app in front.
        float::show_quietly(&pane.window);
        return;
    }
    pane.show_and_focus();
    shell
        .desk
        .pages
        .emit(Role::Eris, "eris://open", Value::Null);
}

pub(super) fn hide(shell: &mut Shell, state: &ErisWindow) {
    let Some(pane) = shell.pane(Role::Eris) else {
        return;
    };
    pane.hide();
    state.open.store(false, Relaxed);
    *lock(&state.folded) = None;
    let _ = pane
        .window
        .request_inner_size(LogicalSize::new(FIGURE.0, FIGURE.1));
    shell
        .desk
        .pages
        .emit(Role::Eris, "eris://fold", Value::Null);
}

/// Grow for her composer, keeping her figure where it is, or fold back to where it was.
pub(super) fn expand(shell: &mut Shell, state: &ErisWindow, open: bool) {
    let Some(pane) = shell.pane(Role::Eris) else {
        return;
    };
    let (Some(monitor), Some(current)) = (pane.window.current_monitor(), rect_of(&pane.window))
    else {
        return;
    };
    let scale = monitor.scale_factor();
    let area = display(&monitor).area;
    let next = if open {
        state.dragged.store(false, Relaxed);
        lock(&state.folded).get_or_insert(current);
        resize(current, physical(OPEN, scale), area)
    } else {
        match lock(&state.folded).take() {
            Some(folded) if !state.dragged.load(Relaxed) => folded,
            _ => resize(current, physical(FIGURE, scale), area),
        }
    };
    state.open.store(open, Relaxed);
    displays::place(&pane.window, next, scale);
    if open {
        pane.show_and_focus();
    }
}

/// Keep her spot on the display she is on, unless the window only grew for the composer.
pub(super) fn moved(shell: &Shell, state: &ErisWindow) {
    if state.open.load(Relaxed) && !state.dragged.load(Relaxed) {
        return;
    }
    let Some(pane) = shell.pane(Role::Eris) else {
        return;
    };
    if !pane.visible() {
        return;
    }
    if let (Some(monitor), Some(rect)) = (pane.window.current_monitor(), rect_of(&pane.window))
        && lock(&state.positions).remember(&display(&monitor), rect)
    {
        let _ = state.keep.send(());
    }
}

/// Write her spots to `file` whole (a partial file, then a rename).
pub(super) fn keep(state: &ErisWindow, file: &Path) {
    let text = lock(&state.positions).to_json();
    let saved = file
        .parent()
        .map_or(Ok(()), std::fs::create_dir_all)
        .and_then(|()| {
            let partial = file.with_extension("json.partial");
            std::fs::write(&partial, text).and_then(|()| std::fs::rename(&partial, file))
        });
    if let Err(why) = saved {
        eprintln!("Eris: her spot was not kept in {} ({why})", file.display());
    }
}
