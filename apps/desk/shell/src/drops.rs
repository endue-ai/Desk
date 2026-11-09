//! Files dragged in from the OS (ADR 0119, the Tauri shell's window drag-drop event). A windowed
//! CEF browser takes the OS drag itself and tells the browser process only that it entered, with the
//! files' paths (`OnDragEnter`); the main window's page hears them as `desk://drag-enter` and follows
//! the rest of the drag in its own document (`apps/desk/src/native-files.ts`), handing the paths to
//! the frame under the pointer or opening them, as with Tauri's events.

use cef::*;
use desk_web::sender::Role;
use serde_json::json;

use crate::host::Pages;

/// The event the main window's page hears when files are dragged in.
pub const ENTER: &str = "desk://drag-enter";

wrap_drag_handler! {
    pub struct Drops {
        pages: Pages,
    }

    impl DragHandler {
        fn on_drag_enter(
            &self,
            _browser: Option<&mut Browser>,
            drag_data: Option<&mut DragData>,
            _mask: DragOperationsMask,
        ) -> ::std::os::raw::c_int {
            let Some(data) = drag_data else { return 0 };
            if data.is_file() != 1 {
                return 0;
            }
            let mut names = CefStringList::new();
            data.file_names(Some(&mut names));
            let paths = local_paths(names);
            if !paths.is_empty() {
                self.pages.emit(Role::Main, ENTER, json!({ "paths": paths }));
            }
            // Let the drag in: the page follows it and decides where the files go.
            0
        }
    }
}

/// The local paths among a drag's file names, once each.
pub fn local_paths(names: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut paths: Vec<String> = Vec::new();
    for name in names {
        if let Some(path) = crate::open_files::local_path(&name)
            && !paths.contains(&path)
        {
            paths.push(path);
        }
    }
    paths
}

#[cfg(test)]
mod tests {
    use super::local_paths;

    #[test]
    fn a_drag_hands_over_local_paths_once_each() {
        let names = [
            "/Docs/한 글.md",
            "/Docs/한 글.md",
            "relative.md",
            "",
            "file:///Docs/a%20b.md",
        ];
        let paths = local_paths(names.map(str::to_owned));
        if cfg!(windows) {
            assert!(paths.is_empty(), "{paths:?}");
        } else {
            assert_eq!(paths, ["/Docs/한 글.md", "/Docs/a b.md"]);
        }
    }
}
