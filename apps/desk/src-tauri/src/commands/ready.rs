/// The runtime reports its status line once the bridge answered. Logged so launches can be checked
/// from the terminal and by smoke tests.
#[tauri::command]
pub fn desk_ready(status: String) {
    println!("{status}");
}
