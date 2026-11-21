//! Files opened with the desk (the command line, Finder and the Dock, a second start handing over its
//! arguments) are a queue of local paths, never file contents or authority to read them. The page
//! hears `desk://open-files` and drains the queue with `take_open_files` (`apps/desk/src/open-files.ts`).
//! Ported from the Tauri shell's `open_files.rs`.
//! `endue://` links (#310, ADR 0244) ride the same queue, in their place among the files: a link the
//! v1 grammar reads is queued in its canonical form, one it refuses as [`REFUSED`] and the sentence
//! why, so the page says so and runs nothing. The page tells them from paths by the `endue:` scheme.
//! The shell's own reason (a file link's file is not there) is in the desk's language (ADR 0276).

use std::sync::Mutex;

use url::Url;

use crate::words::{Language, text};

/// The event that tells the main window's page there are paths to take.
pub const EVENT: &str = "desk://open-files";

#[derive(Default)]
pub struct OpenFiles(Mutex<Vec<String>>);

impl OpenFiles {
    /// Queue `paths` not queued yet; true when that changed the queue.
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

/// What the queue holds for a link the grammar refused: this, then the percent-encoded reason.
pub const REFUSED: &str = "endue:refused?why=";

/// The queue's entry for an `endue:` link: its canonical form, or why it was refused.
pub fn link_entry(text: &str) -> String {
    let refused = |why: &str| format!("{REFUSED}{}", desk_link::encode(why));
    match desk_link::parse(text) {
        // A file link names a file that is there, or nobody is asked about it (#310).
        Ok(desk_link::Link::Open { path }) if !std::path::Path::new(&path).exists() => {
            refused(&file_gone(crate::language::in_force()))
        }
        Ok(link) => link.to_string(),
        Err(why) => refused(&why.0),
    }
}

/// Why a file link is refused when its file is not there, in `language`.
fn file_gone(language: Language) -> String {
    text(language, "desk.links.fileGone")
}

/// What follows `--single-argument` on a raw Windows command line, exactly as it was written
/// (double spaces and tabs kept), as Chromium reads it; `None` without the switch.
pub fn single_argument_rest(raw: &str) -> Option<&str> {
    let at = raw.find(&format!(" {SINGLE_ARGUMENT} "))?;
    Some(&raw[at + SINGLE_ARGUMENT.len() + 2..])
}

/// This process's arguments, the program first. On Windows, after `--single-argument` the raw rest
/// of the command line is the one argument, so a path's double spaces survive the split.
pub fn process_args() -> Vec<String> {
    let split: Vec<String> = std::env::args_os()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    #[cfg(windows)]
    if let Some(rest) = raw_command_line().as_deref().and_then(single_argument_rest) {
        let program = split.first().cloned().unwrap_or_default();
        return vec![program, SINGLE_ARGUMENT.to_owned(), rest.to_owned()];
    }
    split
}

#[cfg(windows)]
#[allow(unsafe_code)]
fn raw_command_line() -> Option<String> {
    // SAFETY: GetCommandLineW returns this process's command line, NUL-terminated, valid for its
    // lifetime; it is only read here.
    unsafe {
        let line = windows_sys::Win32::System::Environment::GetCommandLineW();
        if line.is_null() {
            return None;
        }
        let len = (0..).take_while(|&i| *line.add(i) != 0).count();
        String::from_utf16(std::slice::from_raw_parts(line, len)).ok()
    }
}

/// The queue's entry for a URL the OS hands over (Finder, a browser): a file's path or a link.
pub fn url_entry(text: &str) -> Option<String> {
    if desk_link::is_link(text) {
        return Some(link_entry(text));
    }
    file_url(text)
}

/// The switch Windows' registrations put before `%1` (`packager/windows/registrations.mjs`): what
/// follows it is one argument, however the command line splits, so a link holding `"` adds nothing.
pub const SINGLE_ARGUMENT: &str = "--single-argument";

/// One argument as a queue entry: a link (`endue:`), a path, or nothing.
fn entry(arg: &str) -> Option<String> {
    if desk_link::is_link(arg) {
        Some(link_entry(arg))
    } else {
        local_path(arg)
    }
}

/// Preserve argv boundaries. The executable and options are never treated as files; an `endue:`
/// argument is a link (Windows and Linux hand links over as arguments). After `--single-argument`
/// the rest is one argument, joined back with spaces: a link split at a quote then holds a space,
/// which no link has, and is refused whole.
pub fn argument_paths(args: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut args = args.into_iter().skip(1);
    let mut entries = Vec::new();
    while let Some(arg) = args.next() {
        if arg == SINGLE_ARGUMENT {
            let rest: Vec<String> = args.by_ref().collect();
            entries.extend(entry(&rest.join(" ")));
            break;
        }
        entries.extend(entry(&arg));
    }
    entries
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

/// The local path a `file:` URL names (Finder hands files over as URLs).
pub fn file_url(text: &str) -> Option<String> {
    let url = Url::parse(text).ok()?;
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

/// A local path or a `file:` URL as a local path; anything else is not a document.
pub fn local_path(value: &str) -> Option<String> {
    if value.starts_with("file:") {
        if !value.starts_with("file://") {
            return None;
        }
        return file_url(value);
    }
    absolute_path(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_raw_rest_after_single_argument_keeps_its_spaces() {
        let raw =
            r#""C:\Program Files\endue Desk\endue-desk.exe" --single-argument C:\a  b\c	d.md"#;
        assert_eq!(single_argument_rest(raw), Some("C:\\a  b\\c\td.md"));
        assert_eq!(single_argument_rest(r#""C:\x.exe" C:\a.md"#), None);
        let payload = r#""x.exe" --single-argument endue://x" --gpu-launcher="cmd /c calc" --x=""#;
        let rest = single_argument_rest(payload).unwrap();
        let entries = argument_paths(["x.exe", SINGLE_ARGUMENT, rest].map(str::to_owned));
        assert_eq!(entries.len(), 1, "{entries:?}");
        assert!(entries[0].starts_with(REFUSED), "{entries:?}");
    }

    #[test]
    fn a_file_link_names_a_file_that_is_there() {
        let file = std::env::temp_dir().join(format!("desk-link-{}.md", std::process::id()));
        std::fs::write(&file, "# here").unwrap();
        let path = file.to_string_lossy().replace('\\', "/");
        let link = format!("endue://v1/open?path={}", desk_link::encode(&path));
        assert_eq!(link_entry(&link), link);
        std::fs::remove_file(&file).unwrap();
        assert!(link_entry(&link).starts_with(REFUSED));
        let gone = desk_link::encode("The file this link names is not there.");
        assert_eq!(link_entry(&link), format!("{REFUSED}{gone}"));
        assert_eq!(
            file_gone(Language::Ko),
            "이 링크가 가리키는 파일이 없습니다."
        );
    }

    #[test]
    fn what_follows_single_argument_is_one_argument() {
        let args = |rest: &[&str]| {
            let mut all = vec!["endue-desk".to_owned(), SINGLE_ARGUMENT.to_owned()];
            all.extend(rest.iter().map(|s| (*s).to_owned()));
            argument_paths(all)
        };
        assert_eq!(
            args(&["endue://v1/plugin/endue.notes"]),
            ["endue://v1/plugin/endue.notes"]
        );
        // `endue://x" --gpu-launcher="cmd /c calc" --x="` as Windows splits it: one refused link.
        let split = args(&["endue://x", "--gpu-launcher=cmd", "/c", "calc", "--x="]);
        assert_eq!(split.len(), 1, "{split:?}");
        assert!(split[0].starts_with(REFUSED), "{split:?}");
        assert!(args(&[]).is_empty());
        let file = args(&["C:\\Users\\P\\a b.md"]);
        assert_eq!(file, ["C:/Users/P/a b.md"]);
    }

    #[test]
    fn links_take_their_place_among_the_files() {
        let entries = argument_paths(
            [
                "endue-desk",
                "/Docs/a.md",
                "ENDUE://v1/Plugin/endue.notes",
                "endue://v1/settings/theme",
                "file:///Docs/b%20c.md",
            ]
            .map(str::to_owned),
        );
        let refused = desk_link::encode("This link asks for something the desk does not do.");
        let mut expected = vec![
            "endue://v1/plugin/endue.notes".to_owned(),
            format!("{REFUSED}{refused}"),
        ];
        if !cfg!(windows) {
            expected.insert(0, "/Docs/a.md".to_owned());
            expected.push("/Docs/b c.md".to_owned());
        }
        assert_eq!(entries, expected);
        assert_eq!(
            url_entry("endue://v1/command/endue.notes.new").as_deref(),
            Some("endue://v1/command/endue.notes.new")
        );
        assert_eq!(url_entry("https://example.com/"), None);
    }

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
        assert_eq!(file_url(url).as_deref(), Some(expected));
        for input in [
            "https://example.com/a.pdf",
            "mailto:a@example.com",
            "file:///a%00.pdf",
            "file:///bad%XY.pdf",
            "file:///a.pdf?query",
            "file:///a.pdf#fragment",
        ] {
            assert_eq!(file_url(input), None, "{input}");
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
