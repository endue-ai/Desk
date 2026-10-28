//! Updates (ADR 0021). Release builds (feature `updater`) check the stable channel once Desk has
//! started, and ask before installing: an install restarts Desk, and on Windows it runs the installer.

use tauri::AppHandle;

/// Register the updater plugin on release builds; other builds have none.
pub fn plugin(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    #[cfg(feature = "updater")]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    builder
}

/// Look for an update in the background and offer it.
pub fn check_later(app: &AppHandle) {
    #[cfg(feature = "updater")]
    {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(why) = offer(&app).await {
                eprintln!("endue Desk: update check failed: {why}");
            }
        });
    }
    #[cfg(not(feature = "updater"))]
    let _ = app;
}

#[cfg(feature = "updater")]
async fn offer(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    use tauri_plugin_updater::UpdaterExt;

    let Some(update) = app.updater()?.check().await? else {
        return Ok(());
    };
    let question = format!(
        "endue Desk {} is ready (you have {}). Install it and restart now?",
        update.version, update.current_version
    );
    let dialog = app
        .dialog()
        .message(question)
        .title("Update")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Install and Restart".to_owned(),
            "Later".to_owned(),
        ));
    // The dialog blocks until answered, so it waits on a blocking thread, not this task's.
    let install = tauri::async_runtime::spawn_blocking(move || dialog.blocking_show()).await?;
    if install {
        update.download_and_install(|_, _| {}, || {}).await?;
        app.restart();
    }
    Ok(())
}
