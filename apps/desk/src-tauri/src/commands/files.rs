use tauri::State;

use crate::open_files::OpenFiles;

/// Main-window delivery only. Consumes OS-supplied paths without opening or reading any file.
#[tauri::command]
pub fn take_open_files(queue: State<'_, OpenFiles>) -> Vec<String> {
    queue.take()
}
