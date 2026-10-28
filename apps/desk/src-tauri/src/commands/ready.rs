use crate::commands::boot::Boot;

/// The runtime reports its status line once the bridge answered. Logged so launches can be checked
/// from the terminal and by smoke tests, and recorded so the next launch knows this one finished.
#[tauri::command]
pub fn desk_ready(boot: tauri::State<'_, Boot>, status: String) {
    boot.guard.ready();
    println!("{status}");
}
