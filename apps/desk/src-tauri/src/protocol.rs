//! The `desk-plugin` URL scheme: plugin files by id and path, the plugin SDK
//! (`/_desk/plugin-sdk.js`) and the `@endue-ai/ui` bundle (`/_desk/ui.js`), both embedded, and the
//! files fs.url hands out (`/_desk/file/<token>/<file name>`), with HTTP ranges (ADR 0041).
//!
//! macOS and Linux see `desk-plugin://localhost/<id>/<path>`; Windows sees
//! `http://desk-plugin.localhost/<id>/<path>`. Plugin frames are sandboxed (opaque origin), so
//! responses allow any origin, and HTML gets a CSP that blocks network access: plugins reach the
//! network only through the bridge's net.fetch, under its permission check. Media, images and
//! fonts load from the scheme itself, media and images also from `blob:` and `data:`.

use std::io;
use std::sync::Arc;

use desk_core::{Core, FileUrl, media_type};
use tauri::http::{Method, Request, Response, StatusCode, header};
use tauri::{AppHandle, Manager};

use crate::file_urls;

pub const SCHEME: &str = "desk-plugin";

const SDK_PATH: &str = "_desk/plugin-sdk.js";
const SDK: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../packages/plugin-sdk/dist/plugin-sdk.js"
));
const UI_PATH: &str = "_desk/ui.js";
const UI: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../packages/ui/dist/ui.js"
));
const FILE_PREFIX: &str = "_desk/file/";

const SOURCES: &str = "desk-plugin: http://desk-plugin.localhost";

/// What the scheme serves from the core: plugin files, and the file a URL token names.
pub trait Source {
    fn plugin_file(&self, id: &str, path: &str) -> io::Result<Vec<u8>>;
    fn file_url(&self, token: &str) -> Option<FileUrl>;
}

impl Source for Core {
    fn plugin_file(&self, id: &str, path: &str) -> io::Result<Vec<u8>> {
        Core::plugin_file(self, id, path)
    }

    fn file_url(&self, token: &str) -> Option<FileUrl> {
        Core::file_url(self, token)
    }
}

/// Called off the main thread: a file URL reads from disk.
pub fn serve(app: &AppHandle, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let core = app.state::<Arc<Core>>();
    let response = respond(request, core.as_ref());
    #[cfg(debug_assertions)]
    {
        let range = request.headers().get(header::RANGE);
        let range = range.and_then(|r| r.to_str().ok()).unwrap_or("-");
        eprintln!(
            "desk-plugin: {} {} {range}",
            response.status(),
            request.uri()
        );
    }
    response
}

/// The response for a request: a file URL, one of the embedded bundles, or a plugin's file.
fn respond(request: &Request<Vec<u8>>, source: &impl Source) -> Response<Vec<u8>> {
    let path = decode(request.uri().path().trim_start_matches('/'));
    if let Some(rest) = path.strip_prefix(FILE_PREFIX) {
        let file = match rest.split_once('/') {
            Some((token, _name)) => source.file_url(token),
            None => None,
        };
        let range = request.headers().get(header::RANGE);
        let range = range.and_then(|r| r.to_str().ok());
        return file_urls::respond(file, range, request.method() == Method::HEAD);
    }
    let body = match path.as_str() {
        SDK_PATH => Ok(SDK.as_bytes().to_vec()),
        UI_PATH => Ok(UI.as_bytes().to_vec()),
        _ => match path.split_once('/') {
            Some((id, file)) => source.plugin_file(id, file),
            None => Err(io::Error::from(io::ErrorKind::NotFound)),
        },
    };
    let mut response = Response::builder()
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "no-store");
    match body {
        Ok(bytes) => {
            let mime = mime_type(&path);
            if mime.starts_with("text/html") {
                response = response.header(header::CONTENT_SECURITY_POLICY, plugin_csp());
            }
            response
                .header(header::CONTENT_TYPE, mime)
                .body(bytes)
                .unwrap_or_default()
        }
        Err(error) => {
            let status = match error.kind() {
                io::ErrorKind::PermissionDenied => StatusCode::FORBIDDEN,
                _ => StatusCode::NOT_FOUND,
            };
            response.status(status).body(Vec::new()).unwrap_or_default()
        }
    }
}

fn plugin_csp() -> String {
    format!(
        "default-src 'none'; script-src {SOURCES} 'unsafe-inline'; style-src {SOURCES} 'unsafe-inline'; \
         img-src {SOURCES} data: blob:; media-src {SOURCES} blob: data:; font-src {SOURCES}; \
         connect-src 'none'; frame-src 'none'; form-action 'none'"
    )
}

/// A plugin file's type: the web's own types here, media and documents as fs.url types them.
fn mime_type(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or_default() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "woff2" => "font/woff2",
        "wasm" => "application/wasm",
        _ => media_type(path),
    }
}

/// Percent-decode a URL path. Invalid escapes are kept as they are.
fn decode(path: &str) -> String {
    let hex = |b: u8| (b as char).to_digit(16).map(|d| d as u8);
    let bytes = path.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && let (Some(&hi), Some(&lo)) = (bytes.get(i + 1), bytes.get(i + 2))
            && let (Some(hi), Some(lo)) = (hex(hi), hex(lo))
        {
            out.push(hi * 16 + lo);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::*;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";

    /// The plugin files of `example.hello` (each one's id and path as its content), and one file
    /// URL, `TOKEN`, for `file`.
    struct Fake {
        file: PathBuf,
    }

    impl Fake {
        /// A 100-byte file whose byte `i` is `i`, in a fresh temp file.
        fn new(tag: &str) -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let n = COUNTER.fetch_add(1, Ordering::SeqCst);
            let name = format!("desk-protocol-{tag}-{}-{n}.mp4", std::process::id());
            let file = std::env::temp_dir().join(name);
            std::fs::write(&file, (0u8..100).collect::<Vec<u8>>()).unwrap();
            Self { file }
        }
    }

    impl Drop for Fake {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.file);
        }
    }

    impl Source for Fake {
        fn plugin_file(&self, id: &str, file: &str) -> io::Result<Vec<u8>> {
            let found = (id == "example.hello").then(|| format!("{id} {file}").into_bytes());
            found.ok_or_else(|| io::ErrorKind::NotFound.into())
        }

        fn file_url(&self, token: &str) -> Option<FileUrl> {
            (token == TOKEN).then(|| FileUrl {
                path: self.file.clone(),
                media_type: "video/mp4",
            })
        }
    }

    fn request(method: &str, path: &str, range: Option<&str>) -> Request<Vec<u8>> {
        let mut builder = Request::builder()
            .method(method)
            .uri(format!("desk-plugin://localhost{path}"));
        if let Some(range) = range {
            builder = builder.header(header::RANGE, range);
        }
        builder.body(Vec::new()).unwrap()
    }

    fn get(path: &str, range: Option<&str>) -> Response<Vec<u8>> {
        respond(&request("GET", path, range), &Fake::new("get"))
    }

    fn film(range: Option<&str>) -> Response<Vec<u8>> {
        get(&format!("/_desk/file/{TOKEN}/Holiday%202026.mp4"), range)
    }

    /// A header the response must have.
    fn header_of(response: &Response<Vec<u8>>, name: header::HeaderName) -> &str {
        response.headers()[&name].to_str().unwrap()
    }

    #[test]
    fn the_ui_bundle_and_the_sdk_are_served_as_javascript() {
        for (path, bundle) in [("/_desk/ui.js", UI), ("/_desk/plugin-sdk.js", SDK)] {
            let response = get(path, None);
            assert_eq!(response.status(), StatusCode::OK, "{path}");
            let kind = header_of(&response, header::CONTENT_TYPE);
            assert_eq!(kind, "text/javascript; charset=utf-8", "{path}");
            let csp = response.headers().get(header::CONTENT_SECURITY_POLICY);
            assert!(csp.is_none(), "{path}");
            assert_eq!(response.body().as_slice(), bundle.as_bytes(), "{path}");
        }
        assert!(
            UI.contains("customElements"),
            "the ui bundle defines its elements"
        );
    }

    #[test]
    fn plugin_files_come_from_the_core_and_missing_ones_are_404() {
        let served = get("/example.hello/ui/index.html", None);
        assert_eq!(served.body().as_slice(), b"example.hello ui/index.html");
        assert_eq!(
            header_of(&served, header::CONTENT_SECURITY_POLICY),
            plugin_csp()
        );
        assert_eq!(get("/_desk/other.js", None).status(), StatusCode::NOT_FOUND);
        assert_eq!(
            get("/example.none/a.js", None).status(),
            StatusCode::NOT_FOUND
        );
        // A plugin's own media gets its media type too.
        let video = get("/example.hello/media/intro.MP4", None);
        assert_eq!(header_of(&video, header::CONTENT_TYPE), "video/mp4");
    }

    #[test]
    fn serves_a_file_url_with_one_range() {
        let response = film(Some("bytes=10-19"));
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            header_of(&response, header::CONTENT_RANGE),
            "bytes 10-19/100"
        );
        assert_eq!(header_of(&response, header::CONTENT_LENGTH), "10");
        assert_eq!(header_of(&response, header::ACCEPT_RANGES), "bytes");
        assert_eq!(header_of(&response, header::CONTENT_TYPE), "video/mp4");
        assert_eq!(header_of(&response, header::CACHE_CONTROL), "no-store");
        assert_eq!(
            header_of(&response, header::X_CONTENT_TYPE_OPTIONS),
            "nosniff"
        );
        assert_eq!(response.body().as_slice(), (10u8..20).collect::<Vec<_>>());

        for (range, content_range, first) in [
            ("bytes=90-", "bytes 90-99/100", 90u8),
            ("bytes=-5", "bytes 95-99/100", 95),
            ("bytes=95-500", "bytes 95-99/100", 95),
            ("bytes=0-0", "bytes 0-0/100", 0),
        ] {
            let response = film(Some(range));
            assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT, "{range}");
            assert_eq!(header_of(&response, header::CONTENT_RANGE), content_range);
            assert_eq!(response.body().first(), Some(&first), "{range}");
        }
    }

    #[test]
    fn answers_416_outside_the_file() {
        for range in ["bytes=100-", "bytes=200-300", "bytes=-0"] {
            let response = film(Some(range));
            assert_eq!(
                response.status(),
                StatusCode::RANGE_NOT_SATISFIABLE,
                "{range}"
            );
            assert_eq!(header_of(&response, header::CONTENT_RANGE), "bytes */100");
            assert!(response.body().is_empty());
        }
    }

    #[test]
    fn serves_the_whole_file_without_a_range() {
        let everything: Vec<u8> = (0u8..100).collect();
        // No range, several ranges, or one this server does not understand: the whole file.
        for range in [
            None,
            Some("bytes=0-1,5-9"),
            Some("items=0-5"),
            Some("bytes=9-2"),
        ] {
            let response = film(range);
            assert_eq!(response.status(), StatusCode::OK, "{range:?}");
            assert_eq!(header_of(&response, header::CONTENT_LENGTH), "100");
            assert_eq!(header_of(&response, header::ACCEPT_RANGES), "bytes");
            assert!(response.headers().get(header::CONTENT_RANGE).is_none());
            assert_eq!(response.body(), &everything, "{range:?}");
        }
        let head = respond(
            &request("HEAD", &format!("/_desk/file/{TOKEN}/a.mp4"), None),
            &Fake::new("head"),
        );
        assert_eq!(head.status(), StatusCode::OK);
        assert_eq!(header_of(&head, header::CONTENT_LENGTH), "100");
        assert!(head.body().is_empty());
    }

    #[test]
    fn an_unknown_token_is_not_found() {
        let other = "fedcba9876543210fedcba9876543210";
        for path in [
            format!("/_desk/file/{other}/a.mp4"),
            "/_desk/file/".to_owned(),
            format!("/_desk/file/{TOKEN}"),
        ] {
            let response = get(&path, Some("bytes=0-9"));
            assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
            assert!(response.body().is_empty(), "{path}");
        }
        // A token whose file went away is not found either.
        let fake = Fake::new("gone");
        std::fs::remove_file(&fake.file).unwrap();
        let path = format!("/_desk/file/{TOKEN}/a.mp4");
        let response = respond(&request("GET", &path, None), &fake);
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn the_plugin_csp_allows_media_and_blob_images() {
        let csp = plugin_csp();
        let directive = |name: &str| -> Vec<String> {
            let found = csp
                .split(';')
                .map(str::trim)
                .find(|d| d.split_whitespace().next() == Some(name))
                .unwrap_or_else(|| panic!("no {name} in {csp}"));
            found
                .split_whitespace()
                .skip(1)
                .map(str::to_owned)
                .collect()
        };
        let media = directive("media-src");
        for source in [
            "desk-plugin:",
            "http://desk-plugin.localhost",
            "blob:",
            "data:",
        ] {
            assert!(
                media.iter().any(|s| s == source),
                "media-src {source}: {csp}"
            );
        }
        let images = directive("img-src");
        for source in [
            "desk-plugin:",
            "http://desk-plugin.localhost",
            "blob:",
            "data:",
        ] {
            assert!(
                images.iter().any(|s| s == source),
                "img-src {source}: {csp}"
            );
        }
        assert_eq!(directive("connect-src"), ["'none'"]);
        assert_eq!(directive("frame-src"), ["'none'"]);
        assert_eq!(
            directive("font-src"),
            ["desk-plugin:", "http://desk-plugin.localhost"]
        );
        assert_eq!(directive("default-src"), ["'none'"]);
    }
}
