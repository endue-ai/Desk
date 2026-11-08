//! OS delivery is a queue of local paths, never file contents or authority to read them.
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, Url};

pub const EVENT: &str = "desk://open-files";

#[derive(Default)]
pub struct OpenFiles(Mutex<Vec<String>>);

impl OpenFiles {
    pub fn push(&self, paths: impl IntoIterator<Item = String>) -> bool {
        let mut queue = self.0.lock().unwrap_or_else(|error| error.into_inner());
        let before = queue.len();
        for path in paths {
            if !queue.contains(&path) {
                queue.push(path);
            }
        }
        queue.len() != before
    }

    pub fn take(&self) -> Vec<String> {
        std::mem::take(&mut *self.0.lock().unwrap_or_else(|error| error.into_inner()))
    }
}

/// Preserve argv boundaries. The executable and options are never treated as files.
pub fn argument_paths(args: impl IntoIterator<Item = String>) -> Vec<String> {
    args.into_iter()
        .skip(1)
        .filter_map(|arg| local_path(&arg))
        .collect()
}

fn absolute_path(value: &str) -> Option<String> {
    if value.is_empty() || value.contains('\0') || value.starts_with('-') {
        return None;
    }
    let bytes = value.as_bytes();
    let drive = bytes.len() > 2
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\');
    if drive {
        return Some(value.replace('\\', "/"));
    }
    if value.starts_with("\\\\") || value.starts_with("//") {
        let normalized = value.replace('\\', "/");
        let mut parts = normalized[2..].split('/');
        let server = parts.next()?;
        let share = parts.next()?;
        if server.is_empty() || matches!(server, "?" | ".") || share.is_empty() {
            return None;
        }
        return Some(normalized);
    }
    // Windows /S-style options and root-relative paths lack a drive and are not documents.
    (!cfg!(windows) && value.starts_with('/')).then(|| value.to_owned())
}

pub fn file_url(url: &Url) -> Option<String> {
    if url.scheme() != "file"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    // Url parsing accepts invalid percent escapes; a malformed OS path must not be reinterpreted.
    let bytes = url.path().as_bytes();
    for (i, byte) in bytes.iter().enumerate() {
        if *byte == b'%'
            && (bytes.get(i + 1).is_none_or(|b| !b.is_ascii_hexdigit())
                || bytes.get(i + 2).is_none_or(|b| !b.is_ascii_hexdigit()))
        {
            return None;
        }
    }
    let path = url.to_file_path().ok()?;
    absolute_path(path.to_str()?)
}

fn local_path(value: &str) -> Option<String> {
    if value.starts_with("file:") {
        if !value.starts_with("file://") {
            return None;
        }
        return file_url(&Url::parse(value).ok()?);
    }
    absolute_path(value)
}

pub fn focus(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn deliver(app: &AppHandle, paths: impl IntoIterator<Item = String>) {
    if app.state::<OpenFiles>().push(paths) {
        // A missed event is harmless: the frontend subscribes before its first consuming drain.
        let _ = app.emit_to("main", EVENT, ());
        focus(app);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arguments_preserve_spaces_unicode_and_windows_boundaries() {
        let paths = argument_paths(
            [
                "/path/endue-desk",
                "/Docs/한 글.pdf",
                "C:\\Users\\Person\\two words.png",
                "\\\\server\\share\\report.pdf",
                "--inspect",
                "relative.pdf",
                "https://example.com/file.pdf",
                "",
                "--",
                "C:relative.pdf",
                "/invalid\0.pdf",
                "\\\\.\\pipe\\device",
            ]
            .map(str::to_owned),
        );
        let mut expected = vec!["C:/Users/Person/two words.png", "//server/share/report.pdf"];
        if !cfg!(windows) {
            expected.insert(0, "/Docs/한 글.pdf");
        }
        assert_eq!(paths, expected);
    }

    #[test]
    fn file_urls_decode_without_treating_other_schemes_as_paths() {
        #[cfg(not(windows))]
        let (url, expected) = ("file:///Docs/%ED%95%9C%20%EA%B8%80.pdf", "/Docs/한 글.pdf");
        #[cfg(windows)]
        let (url, expected) = (
            "file:///C:/Docs/%ED%95%9C%20%EA%B8%80.pdf",
            "C:/Docs/한 글.pdf",
        );
        assert_eq!(
            file_url(&Url::parse(url).unwrap()).as_deref(),
            Some(expected)
        );
        for input in [
            "https://example.com/a.pdf",
            "mailto:a@example.com",
            "file:///a%00.pdf",
            "file:///bad%XY.pdf",
            "file:///a.pdf?query",
            "file:///a.pdf#fragment",
        ] {
            assert_eq!(file_url(&Url::parse(input).unwrap()), None, "{input}");
        }
    }

    #[test]
    fn malformed_local_paths_are_not_reinterpreted() {
        for input in [
            "file:relative.pdf",
            "file:/relative.pdf",
            r"\\server",
            r"\\",
            "//?/C:/file.pdf",
            "//./pipe/device",
        ] {
            assert_eq!(local_path(input), None, "{input}");
        }
        #[cfg(windows)]
        for input in ["/S", "/quiet", "/Docs/file.pdf"] {
            assert_eq!(local_path(input), None, "{input}");
        }
    }

    #[test]
    fn draining_consumes_once_and_later_arrivals_remain_available() {
        let queue = OpenFiles::default();
        assert!(queue.push(["/one.pdf".into(), "/two.png".into(), "/one.pdf".into()]));
        assert!(!queue.push(["/one.pdf".into()]));
        assert_eq!(queue.take(), ["/one.pdf", "/two.png"]);
        assert!(queue.take().is_empty());
        assert!(queue.push(["/one.pdf".into()]));
        assert_eq!(queue.take(), ["/one.pdf"]);
    }
}
