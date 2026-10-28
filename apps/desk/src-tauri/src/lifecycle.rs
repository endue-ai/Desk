//! The app's life around its frames (ADR 0019): closing the last frame leaves the core running, so
//! processes, watches, brain turns and the wake word go on. macOS keeps Desk in the Dock and opens a
//! frame from it; Windows and Linux keep a tray icon (Open, New Frame, Restart in Safe Mode, Quit).
//! Where no tray can be shown, closing the last frame quits, so Desk never runs out of reach.

use std::sync::Arc;

use desk_core::Core;
use tauri::{App, AppHandle, Manager, RunEvent, WindowEvent};

use crate::commands::boot::Boot;
use crate::frames::{self, Routing};

/// Present while the app stays up without frames.
pub struct Resident;

/// Set up what keeps Desk reachable without a frame. Returns whether it stays resident.
pub fn install(app: &App) -> bool {
    #[cfg(target_os = "macos")]
    let resident = {
        let _ = app;
        true
    };
    #[cfg(not(target_os = "macos"))]
    let resident = tray::build(app.handle())
        .inspect_err(|why| eprintln!("endue Desk: no tray icon ({why}); the last frame quits"))
        .is_ok();
    if resident {
        app.manage(Resident);
    }
    resident
}

pub fn on_run_event(app: &AppHandle, event: RunEvent) {
    match event {
        // Only the last frame closing asks with no code; Quit (app.exit) and restarts carry one.
        RunEvent::ExitRequested {
            code: None, api, ..
        } if app.try_state::<Resident>().is_some() => {
            api.prevent_exit();
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } => frames::show(app),
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::Destroyed,
            ..
        } => {
            if let Some(routing) = app.try_state::<Routing>() {
                routing.closed(&label);
            }
        }
        RunEvent::Exit => {
            if let Some(core) = app.try_state::<Arc<Core>>() {
                core.shutdown();
            }
        }
        _ => {}
    }
}

/// Start again in safe mode (ADR 0017).
pub fn restart_in_safe_mode(app: &AppHandle) {
    app.state::<Boot>().guard.safe_next();
    app.restart();
}

#[cfg(not(target_os = "macos"))]
mod tray {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::{AppHandle, Manager};

    use super::{frames, restart_in_safe_mode};

    pub fn build(app: &AppHandle) -> Result<(), String> {
        menu_tray(app).map_err(|e| e.to_string())?
    }

    /// The tray, or why it could not be shown. Linux loads the tray library when the icon is built;
    /// a missing one panics there, and that must not end Desk.
    fn menu_tray(app: &AppHandle) -> tauri::Result<Result<(), String>> {
        let open = MenuItem::with_id(app, "open", "Open endue Desk", true, None::<&str>)?;
        let frame = MenuItem::with_id(app, "frame", "New Frame", true, None::<&str>)?;
        let safe = MenuItem::with_id(app, "safe", "Restart in Safe Mode", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", "Quit endue Desk", true, None::<&str>)?;
        let separator = PredefinedMenuItem::separator(app)?;
        let menu = Menu::with_items(app, &[&open, &frame, &separator, &safe, &quit])?;
        let mut builder = TrayIconBuilder::with_id("desk")
            .tooltip("endue Desk")
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_menu_event(|app, event| match event.id().as_ref() {
                "open" => frames::show(app),
                "frame" => {
                    let _ = frames::open(app, None);
                }
                "safe" => restart_in_safe_mode(app),
                "quit" => app.exit(0),
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    frames::show(tray.app_handle());
                }
            });
        if let Some(icon) = app.default_window_icon() {
            builder = builder.icon(icon.clone());
        }
        let built = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| builder.build(app)));
        match built {
            Ok(tray) => {
                app.manage(tray?);
                Ok(Ok(()))
            }
            Err(_) => Ok(Err("the system tray library is missing".to_owned())),
        }
    }
}
