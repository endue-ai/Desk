//! The floating window itself (ADR 0121): shown on the display the person is using at her spot
//! there, quietly or summoned; hidden; grown for her composer and folded back; her spot kept.

use std::path::Path;
use std::sync::atomic::Ordering::Relaxed;

use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, Monitor, PhysicalPosition, PhysicalSize,
    WebviewWindow,
};

#[cfg(target_os = "macos")]
use super::macos;
use super::place::{Display, Rect, display_key, resize};
use super::{ErisWindow, FIGURE, LABEL, MARGIN, OPEN, lock};

pub(super) fn show(app: &AppHandle, summon: bool) -> tauri::Result<()> {
    let (Some(window), Some(state)) =
        (app.get_webview_window(LABEL), app.try_state::<ErisWindow>())
    else {
        return Ok(());
    };
    if !window.is_visible()? {
        // Folded, on the display the person is using, at her spot there.
        state.open.store(false, Relaxed);
        *lock(&state.folded) = None;
        if let Some(monitor) = cursor_monitor(app) {
            let scale = monitor.scale_factor();
            let margin = (MARGIN * scale).round() as u32;
            let at =
                lock(&state.positions).place(&display(&monitor), physical(FIGURE, scale), margin);
            window.set_position(PhysicalPosition::new(at.x, at.y))?;
        }
        window.set_size(LogicalSize::new(FIGURE.0, FIGURE.1))?;
    }
    if !summon {
        return show_quietly(app, &window);
    }
    #[cfg(not(target_os = "macos"))]
    window.set_focusable(true)?;
    window.show()?;
    window.set_focus()?;
    app.emit_to(LABEL, "eris://open", ())
}

/// Shown without taking the focus from the app in front.
#[cfg(target_os = "macos")]
pub(super) fn show_quietly(app: &AppHandle, _: &WebviewWindow) -> tauri::Result<()> {
    let handle = app.clone();
    app.run_on_main_thread(move || {
        if let Some(window) = handle.get_webview_window(LABEL)
            && let Ok(ns_window) = window.ns_window()
        {
            macos::show_quietly(ns_window);
        }
    })
}

#[cfg(not(target_os = "macos"))]
pub(super) fn show_quietly(_: &AppHandle, window: &WebviewWindow) -> tauri::Result<()> {
    window.set_focusable(false)?;
    window.show()
}

pub(super) fn hide(app: &AppHandle) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(LABEL) else {
        return Ok(());
    };
    window.hide()?;
    if let Some(state) = app.try_state::<ErisWindow>() {
        state.open.store(false, Relaxed);
        *lock(&state.folded) = None;
    }
    window.set_size(LogicalSize::new(FIGURE.0, FIGURE.1))?;
    app.emit_to(LABEL, "eris://fold", ())
}

/// Grow for her composer, keeping her figure where it is, or fold back to where it was.
pub(super) fn expand(window: &WebviewWindow, open: bool) -> tauri::Result<()> {
    let app = window.app_handle();
    let (Some(state), Some(monitor)) = (app.try_state::<ErisWindow>(), window.current_monitor()?)
    else {
        return Ok(());
    };
    let scale = monitor.scale_factor();
    let (current, area) = (rect_of(window)?, display(&monitor).area);
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
    window.set_position(PhysicalPosition::new(next.x, next.y))?;
    window.set_size(PhysicalSize::new(next.width, next.height))?;
    if open {
        #[cfg(not(target_os = "macos"))]
        window.set_focusable(true)?;
        window.set_focus()?;
    }
    Ok(())
}

/// Keep her spot on the display she is on, unless the window only grew for the composer.
pub(super) fn moved(app: &AppHandle, state: &ErisWindow) {
    if state.open.load(Relaxed) && !state.dragged.load(Relaxed) {
        return;
    }
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    if !window.is_visible().unwrap_or(false) {
        return;
    }
    if let (Ok(Some(monitor)), Ok(rect)) = (window.current_monitor(), rect_of(&window))
        && lock(&state.positions).remember(&display(&monitor), rect)
    {
        let _ = state.keep.send(());
    }
}

pub(super) fn keep(app: &AppHandle, file: &Path) {
    let Some(state) = app.try_state::<ErisWindow>() else {
        return;
    };
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

pub(super) fn cursor_monitor(app: &AppHandle) -> Option<Monitor> {
    let at = app.cursor_position().ok();
    at.and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())
}

pub(super) fn display(monitor: &Monitor) -> Display {
    let (origin, size, area) = (monitor.position(), monitor.size(), monitor.work_area());
    Display {
        key: display_key(
            monitor.name().map(String::as_str),
            (origin.x, origin.y),
            (size.width, size.height),
        ),
        area: Rect {
            x: area.position.x,
            y: area.position.y,
            width: area.size.width,
            height: area.size.height,
        },
    }
}

pub(super) fn rect_of(window: &WebviewWindow) -> tauri::Result<Rect> {
    let (at, size) = (window.outer_position()?, window.outer_size()?);
    Ok(Rect {
        x: at.x,
        y: at.y,
        width: size.width,
        height: size.height,
    })
}

pub(super) fn physical(size: (f64, f64), scale: f64) -> (u32, u32) {
    (
        (size.0 * scale).round() as u32,
        (size.1 * scale).round() as u32,
    )
}
