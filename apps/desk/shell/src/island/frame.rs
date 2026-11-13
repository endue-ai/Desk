//! The island's window (ADR 0204): placed on the display the person left it on, at their spot
//! there, and shown without taking the keys; hidden; grown open and folded back; its spot kept.
//! The page hears `island://open` with whether it is open, which the shell alone decides. Runs on
//! the event loop's thread.

use std::path::Path;
use std::sync::atomic::Ordering::Relaxed;

use desk_web::sender::Role;
use serde_json::json;
use winit::dpi::LogicalSize;

use super::{CLOSED, Island, MARGIN, OPEN, TALLEST, screens};
use crate::displays::{self, display, physical, rect_of};
use crate::eris_window::lock;
use crate::eris_window::place::{Display, resize};
use crate::window::Shell;

/// Show it, closed and in its place the first time, without taking the keys from the app in front.
pub(super) fn show(shell: &mut Shell, state: &Island) {
    if shell.pane(Role::Island).is_some_and(|pane| !pane.visible()) {
        place(shell, state);
    }
    if let Some(pane) = shell.pane(Role::Island) {
        pane.show_quietly();
    }
}

pub(super) fn hide(shell: &mut Shell, state: &Island) {
    let Some(pane) = shell.pane(Role::Island) else {
        return;
    };
    pane.hide();
    fold_state(shell, state);
}

/// Put it, closed, on the display the person last left it on, else the one under the pointer, at
/// their spot there or at the top in the middle.
pub(super) fn place(shell: &Shell, state: &Island) {
    let Some(pane) = shell.pane(Role::Island) else {
        return;
    };
    let monitors: Vec<_> = pane.window.available_monitors().collect();
    let connected: Vec<Display> = monitors.iter().map(display).collect();
    let pointer = displays::cursor_monitor(&pane.window).map(|m| display(&m));
    let kept = lock(&state.kept);
    let Some(target) = kept.display(&connected, pointer.as_ref()) else {
        drop(kept);
        let _ = (pane.window).request_inner_size(LogicalSize::new(CLOSED.0, CLOSED.1));
        fold_state(shell, state);
        return;
    };
    let scale = (monitors.iter().zip(&connected))
        .find(|(_, d)| d.key == target.key)
        .map_or(1.0, |(m, _)| m.scale_factor());
    let margin = (MARGIN * scale).round() as u32;
    let at = kept.place(target, physical(CLOSED, scale), margin);
    drop(kept);
    displays::place(&pane.window, at, scale);
    *lock(&state.placed) = rect_of(&pane.window);
    screens::settled();
    fold_state(shell, state);
}

/// Grow it open, keeping the middle of its top edge where it is, or fold it back to where it was.
pub(super) fn expand(shell: &mut Shell, state: &Island, open: bool) {
    let Some(pane) = shell.pane(Role::Island) else {
        return;
    };
    if state.open.load(Relaxed) == open {
        tell(shell, open);
        return;
    }
    let (Some(monitor), Some(current)) = (pane.window.current_monitor(), rect_of(&pane.window))
    else {
        return;
    };
    let scale = monitor.scale_factor();
    let area = display(&monitor).area;
    let next = if open {
        state.dragged.store(false, Relaxed);
        lock(&state.folded).get_or_insert(current);
        resize(current, physical(open_size(state), scale), area)
    } else {
        match lock(&state.folded).take() {
            Some(folded) if !state.dragged.load(Relaxed) => folded,
            _ => resize(current, physical(CLOSED, scale), area),
        }
    };
    state.open.store(open, Relaxed);
    displays::place(&pane.window, next, scale);
    *lock(&state.placed) = rect_of(&pane.window);
    tell(shell, open);
}

/// The page says how tall the open island is: it fits its window to it, keeping its top edge.
pub(super) fn fit(shell: &mut Shell, state: &Island, height: f64) {
    let height = height.clamp(CLOSED.1, TALLEST);
    state.height.store(height.round() as u32, Relaxed);
    if !state.open.load(Relaxed) {
        return;
    }
    let Some(pane) = shell.pane(Role::Island) else {
        return;
    };
    let (Some(monitor), Some(current)) = (pane.window.current_monitor(), rect_of(&pane.window))
    else {
        return;
    };
    let scale = monitor.scale_factor();
    let next = resize(
        current,
        physical(open_size(state), scale),
        display(&monitor).area,
    );
    if next != current {
        displays::place(&pane.window, next, scale);
        *lock(&state.placed) = rect_of(&pane.window);
    }
}

fn open_size(state: &Island) -> (f64, f64) {
    (OPEN.0, f64::from(state.height.load(Relaxed)))
}

/// Keep its spot when the person moved it: not while it only grew open, not where the shell put
/// it, and not while the displays change under it.
pub(super) fn moved(shell: &Shell, state: &Island) {
    if state.open.load(Relaxed) && !state.dragged.load(Relaxed) {
        return;
    }
    let Some(pane) = shell.pane(Role::Island) else {
        return;
    };
    if !pane.visible() || screens::changing() {
        return;
    }
    let (Some(monitor), Some(rect)) = (pane.window.current_monitor(), rect_of(&pane.window)) else {
        return;
    };
    if *lock(&state.placed) == Some(rect) {
        return;
    }
    // Open or closed, its spot is the middle of its top edge, which growing open keeps.
    if lock(&state.kept).remember(&display(&monitor), rect) {
        let _ = state.keep.send(());
    }
}

/// Write what is kept to `file` whole (a partial file, then a rename).
pub(super) fn keep(state: &Island, file: &Path) {
    let text = lock(&state.kept).to_json();
    let saved = file
        .parent()
        .map_or(Ok(()), std::fs::create_dir_all)
        .and_then(|()| {
            let partial = file.with_extension("json.partial");
            std::fs::write(&partial, text).and_then(|()| std::fs::rename(&partial, file))
        });
    if let Err(why) = saved {
        eprintln!(
            "island: its place was not kept in {} ({why})",
            file.display()
        );
    }
}

/// It is closed now: nothing to fold back to.
fn fold_state(shell: &Shell, state: &Island) {
    state.open.store(false, Relaxed);
    *lock(&state.folded) = None;
    tell(shell, false);
}

fn tell(shell: &Shell, open: bool) {
    let payload = json!({ "open": open });
    shell
        .desk
        .pages
        .emit(Role::Island, "island://open", payload);
}
