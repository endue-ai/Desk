//! Files dragged in from the OS (ADR 0119): the local paths a drag carries. OS file drops reach the
//! desk through winit and the compositor's drag broker (#56, ADR 0150), which hands them to the
//! surface under the pointer (`web_host/routes.rs`). Stage 1's windowed browser took the OS drag
//! itself and told the page that it entered (`desk://drag-enter`); that handler went with the
//! windowed desk (#83).

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
