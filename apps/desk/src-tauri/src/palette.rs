//! An OS-level search window, independent of the main window's layout or focused application.
use desk_bridge::{CmdInvokePermission, Permission, SearchReadPermission, SearchSystemPermission};
use desk_core::Core;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

// One segment is a valid core caller but cannot be an installed PluginId.
pub const CALLER: &str = "palette";
pub const LABEL: &str = "palette";

pub fn setup(app: &tauri::App, core: &Core) -> tauri::Result<()> {
    core.grant(
        CALLER,
        Permission::SearchRead(SearchReadPermission {
            permission: Default::default(),
        }),
    );
    core.grant(
        CALLER,
        Permission::SearchSystem(SearchSystemPermission {
            permission: Default::default(),
        }),
    );
    core.grant(
        CALLER,
        Permission::CmdInvoke(CmdInvokePermission {
            permission: Default::default(),
            ids: vec!["*".into()],
        }),
    );
    WebviewWindowBuilder::new(
        app,
        LABEL,
        WebviewUrl::App("index.html?view=palette".into()),
    )
    .title("Search Desk")
    .inner_size(680.0, 480.0)
    .decorations(false)
    .resizable(false)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .skip_taskbar(true)
    .visible(false)
    .focused(false)
    .build()?;
    // Preserve macOS Spotlight and input-source shortcuts. This can be changed before app startup.
    let shortcut = std::env::var("DESK_PALETTE_SHORTCUT")
        .unwrap_or_else(|_| "CommandOrControl+Shift+Space".into());
    if let Err(why) = app
        .global_shortcut()
        .on_shortcut(shortcut.as_str(), |app, _, event| {
            if event.state == ShortcutState::Pressed
                && let Some(window) = app.get_webview_window(LABEL)
            {
                if window.is_visible().unwrap_or(false) {
                    let _ = window.hide();
                } else if let Err(why) = show(app) {
                    eprintln!("Search Desk: {why}");
                }
            }
        })
    {
        eprintln!("Search Desk shortcut unavailable ({shortcut}): {why}. Use the tray menu.");
    }
    if let Some(window) = app.get_webview_window(LABEL) {
        let handle = app.handle().clone();
        window.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Some(window) = handle.get_webview_window(LABEL) {
                    let _ = window.hide();
                }
            }
            if let WindowEvent::Focused(false) = event
                && let Some(window) = handle.get_webview_window(LABEL)
            {
                let _ = window.hide();
            }
        });
    }
    crate::tray::setup(app)?;
    Ok(())
}

pub fn show(app: &tauri::AppHandle) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(LABEL) else {
        return Ok(());
    };
    // Put it on the display the person is using, in logical-independent physical coordinates.
    if let Ok(Some(monitor)) = app
        .cursor_position()
        .and_then(|p| app.monitor_from_point(p.x, p.y))
    {
        let size = window.outer_size()?;
        let origin = monitor.position();
        let screen = monitor.size();
        let x = origin.x + (screen.width as i32 - size.width as i32) / 2;
        let y = origin.y + ((screen.height as i32 - size.height as i32) / 4).max(0);
        window.set_position(tauri::PhysicalPosition::new(x, y))?;
    }
    window.show()?;
    window.set_focus()?;
    window.emit("palette://open", ())
}

pub fn reveal_main(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(LABEL) {
        window.hide()?;
    }
    if let Some(window) = app.get_webview_window("main") {
        window.unminimize()?;
        window.show()?;
        window.set_focus()?;
    }
    Ok(())
}

#[tauri::command]
pub fn palette_hide(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != LABEL {
        return Err("Only the palette can hide itself".into());
    }
    window.hide().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn palette_reveal_main(app: tauri::AppHandle) -> Result<(), String> {
    reveal_main(&app).map_err(|e| e.to_string())
}

/// Commands can open a picker in the main runtime. Make it visible while retaining palette focus.
#[tauri::command]
pub fn palette_prepare_main(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.unminimize().map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Restore a failed native action without clearing its query or error message.
#[tauri::command]
pub fn palette_present(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != LABEL {
        return Err("Only the palette can show itself".into());
    }
    window
        .show()
        .and_then(|()| window.set_focus())
        .map_err(|e| e.to_string())
}
