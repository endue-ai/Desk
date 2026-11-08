//! The app's run events from the OS (macOS): `Opened` hands the files opened with the desk to the
//! open-files queue, and `Reopen`, a click on the Dock icon, shows the main window again, since
//! closing it only hides it (#583). Windows and Linux bring it back through single-instance.

use tauri::{AppHandle, RunEvent};

/// The app's run handler (`App::run`).
#[cfg_attr(not(target_os = "macos"), allow(unused_variables))]
pub fn handle(app: &AppHandle, event: RunEvent) {
    #[cfg(target_os = "macos")]
    match event {
        RunEvent::Opened { urls } => {
            let paths = urls.iter().filter_map(crate::open_files::file_url);
            crate::open_files::deliver(app, paths);
        }
        RunEvent::Reopen {
            has_visible_windows,
            ..
        } => reopen(app, has_visible_windows),
        _ => {}
    }
}

/// A click on the Dock icon shows and focuses the main window, the way the tray's Open Desk does,
/// when [`reopen_shows_main`] says so.
#[cfg(target_os = "macos")]
fn reopen(app: &AppHandle, has_visible_windows: bool) {
    use tauri::Manager;
    let main_visible = app
        .get_webview_window("main")
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);
    if reopen_shows_main(main_visible, has_visible_windows)
        && let Err(why) = crate::palette::reveal_main(app)
    {
        eprintln!("endue Desk: the Dock icon could not show the main window ({why})");
    }
}

/// Whether a click on the Dock icon brings the main window back: when it is hidden (closed,
/// minimized or missing), or when macOS finds none of the desk's windows visible. With main in view
/// the click only activates the app, as it does for any Mac app.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn reopen_shows_main(main_visible: bool, has_visible_windows: bool) -> bool {
    !main_visible || !has_visible_windows
}

#[cfg(test)]
mod tests {
    use super::reopen_shows_main;

    #[test]
    fn the_dock_icon_shows_main_when_it_is_hidden_or_nothing_is_visible() {
        // Closed (hidden) or minimized while another desk window, floating Eris, is in view.
        assert!(reopen_shows_main(false, true));
        // Closed and nothing of the desk's on screen.
        assert!(reopen_shows_main(false, false));
        // macOS finds no visible window although main says it is shown: show it anyway.
        assert!(reopen_shows_main(true, false));
        // Main in view: the click only activates the app.
        assert!(!reopen_shows_main(true, true));
    }
}
