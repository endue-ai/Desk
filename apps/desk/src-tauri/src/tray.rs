//! The tray (ADR 0053): Search Desk, Open Desk and Quit Desk keep the app reachable when the
//! shortcut is taken, and "Restart to update (<version>)" appears while a build is staged (ADR
//! 0054). A click there is the person's own, so it applies without asking.

use std::sync::Mutex;

use desk_update::{State, Status, Updater};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Runtime};

use crate::palette;
use crate::update::Updates;

const ID: &str = "desk";

pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    let mut tray = TrayIconBuilder::with_id(ID)
        .tooltip("endue Desk")
        .menu(&menu(app.handle(), None)?)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "search" => {
                let _ = palette::show(app);
            }
            "desk" => {
                let _ = palette::reveal_main(app);
            }
            "update" => {
                if let Some(updates) = app.try_state::<Updates>() {
                    let _ = updates.0.apply();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn menu<R: Runtime>(app: &AppHandle<R>, staged: Option<&str>) -> tauri::Result<Menu<R>> {
    let search = MenuItem::with_id(app, "search", "Search Desk", true, None::<&str>)?;
    let desk = MenuItem::with_id(app, "desk", "Open Desk", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Desk", true, None::<&str>)?;
    match staged {
        Some(version) => {
            let label = format!("Restart to update ({version})");
            let update = MenuItem::with_id(app, "update", label, true, None::<&str>)?;
            Menu::with_items(app, &[&search, &desk, &update, &quit])
        }
        None => Menu::with_items(app, &[&search, &desk, &quit]),
    }
}

/// The version the tray offers to restart into: the staged build's, unless it is being applied.
pub fn offered(status: &Status) -> Option<&str> {
    let ready = status.staged && matches!(status.state, State::Staged | State::Failed);
    ready
        .then(|| status.release.as_ref().map(|r| r.version.as_str()))
        .flatten()
}

/// Keep the tray's update item in step with `updater`.
pub fn follow<R: Runtime>(app: &AppHandle<R>, updater: &Updater) {
    let shown = Mutex::new(None::<String>);
    let app = app.clone();
    let show = move |status: &Status| {
        let offer = offered(status).map(str::to_owned);
        let mut last = shown.lock().unwrap_or_else(|p| p.into_inner());
        if *last == offer {
            return;
        }
        last.clone_from(&offer);
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let (Some(tray), Ok(menu)) = (handle.tray_by_id(ID), menu(&handle, offer.as_deref()))
            {
                let _ = tray.set_menu(Some(menu));
            }
        });
    };
    show(&updater.status());
    updater.listen(show);
}
