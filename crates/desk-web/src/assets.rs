//! The shell's own files on `desk-app://app/`: the built web runtime (`apps/desk/dist`).

use std::path::{Component, Path, PathBuf};

use crate::{Reply, mime};

/// The shell page's Content-Security-Policy. Plugins never load here: they live on `desk-plugin:`,
/// in frames this policy allows, and reach the core only through the bridge.
pub const SHELL_CSP: &str = "default-src 'self'; script-src 'self'; \
    style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: desk-plugin:; \
    font-src 'self' data: desk-plugin:; media-src 'self' blob: desk-plugin:; \
    frame-src 'self' data: blob: desk-plugin:; connect-src 'self' desk-plugin:; \
    worker-src 'self' blob:; object-src 'none'; base-uri 'none'";

/// Answer `path` (the URL path, `/` or `/assets/x.js`) from the files under `root`.
pub fn serve(root: &Path, path: &str) -> Reply {
    let Some(file) = resolve(root, path) else {
        return Reply::status(404);
    };
    match std::fs::read(&file) {
        Ok(body) => {
            let name = file.to_string_lossy();
            let mime = mime::for_path(&name);
            let mut headers = vec![("Cache-Control".to_owned(), "no-cache".to_owned())];
            if mime == "text/html" {
                headers.push(("Content-Security-Policy".to_owned(), SHELL_CSP.to_owned()));
            }
            Reply {
                status: 200,
                mime: mime.to_owned(),
                headers,
                body,
            }
        }
        Err(_) => Reply::status(404),
    }
}

/// The file `path` names under `root`, or `None` when it climbs out, is hidden or does not exist.
fn resolve(root: &Path, path: &str) -> Option<PathBuf> {
    let path = path.split(['?', '#']).next().unwrap_or_default();
    let path = percent_decode(path)?;
    let relative = Path::new(path.trim_start_matches('/'));
    let mut file = root.to_path_buf();
    for component in relative.components() {
        match component {
            Component::Normal(part) if !part.to_string_lossy().starts_with('.') => file.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    if file.is_dir() {
        file.push("index.html");
    }
    file.is_file().then_some(file)
}

/// `%XX` sequences decoded; `None` when they do not form UTF-8 or decode to a NUL.
fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    let decoded = String::from_utf8(out).ok()?;
    (!decoded.contains('\0')).then_some(decoded)
}

#[cfg(test)]
mod tests {
    use super::{SHELL_CSP, serve};
    use std::fs;

    fn root() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("index.html"),
            "<!doctype html><title>desk</title>",
        )
        .unwrap();
        fs::create_dir(dir.path().join("assets")).unwrap();
        fs::write(dir.path().join("assets/app.js"), "export {};").unwrap();
        fs::write(dir.path().join("assets/a b.css"), "body{}").unwrap();
        fs::write(dir.path().join(".env"), "SECRET=1").unwrap();
        dir
    }

    #[test]
    fn the_root_answers_index_html_with_the_shell_csp() {
        let dir = root();
        let reply = serve(dir.path(), "/");
        assert_eq!(reply.status, 200);
        assert_eq!(reply.mime, "text/html");
        assert!(
            reply
                .headers
                .iter()
                .any(|(n, v)| n == "Content-Security-Policy" && v == SHELL_CSP)
        );
    }

    #[test]
    fn files_answer_with_their_type_and_without_the_csp() {
        let dir = root();
        let reply = serve(dir.path(), "/assets/app.js?v=3");
        assert_eq!(reply.status, 200);
        assert_eq!(reply.mime, "text/javascript");
        assert_eq!(reply.body, b"export {};");
        assert!(
            reply
                .headers
                .iter()
                .all(|(n, _)| n != "Content-Security-Policy")
        );
        assert_eq!(serve(dir.path(), "/assets/a%20b.css").status, 200);
    }

    #[test]
    fn missing_hidden_and_escaping_paths_are_not_found() {
        let dir = root();
        assert_eq!(serve(dir.path(), "/nope.js").status, 404);
        assert_eq!(serve(dir.path(), "/.env").status, 404);
        assert_eq!(serve(dir.path(), "/../etc/passwd").status, 404);
        assert_eq!(serve(dir.path(), "/assets/%2e%2e/%2e%2e/x").status, 404);
        assert_eq!(serve(dir.path(), "/a%00b").status, 404);
        assert_eq!(serve(dir.path(), "/bad%zz").status, 404);
    }
}
