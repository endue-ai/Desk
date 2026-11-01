//! The `desk-plugin` scheme's unit tests (`protocol.rs`).

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

/// The sources of one CSP directive, which must be there.
fn directive(csp: &str, name: &str) -> Vec<String> {
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
}

const SCHEME_FORMS: [&str; 2] = ["desk-plugin:", "http://desk-plugin.localhost"];

#[test]
fn the_plugin_csp_allows_media_and_blob_images() {
    let csp = plugin_csp();
    for name in ["media-src", "img-src"] {
        let sources = directive(&csp, name);
        for source in SCHEME_FORMS.iter().copied().chain(["blob:", "data:"]) {
            assert!(
                sources.iter().any(|s| s == source),
                "{name} {source}: {csp}"
            );
        }
    }
    assert_eq!(directive(&csp, "font-src"), SCHEME_FORMS);
    assert_eq!(directive(&csp, "default-src"), ["'none'"]);
    assert_eq!(directive(&csp, "form-action"), ["'none'"]);
}

#[test]
fn the_plugin_csp_runs_workers_and_webassembly_and_fetches_only_the_desk() {
    let csp = plugin_csp();
    // A module worker starts from a blob: trampoline that imports the plugin's file: WebKit checks a
    // module worker's whole import graph against worker-src, so the scheme is there too.
    let workers = directive(&csp, "worker-src");
    assert_eq!(workers[0], "blob:");
    assert_eq!(workers[1..], SCHEME_FORMS);
    let scripts = directive(&csp, "script-src");
    for source in SCHEME_FORMS
        .iter()
        .copied()
        .chain(["'unsafe-inline'", "'wasm-unsafe-eval'"])
    {
        assert!(
            scripts.iter().any(|s| s == source),
            "script-src {source}: {csp}"
        );
    }
    // WebAssembly compiles; JavaScript eval stays off.
    assert!(!scripts.iter().any(|s| s == "'unsafe-eval'"), "{csp}");
    // fetch reaches the scheme (file URLs, the plugin's own files) and nothing else.
    assert_eq!(directive(&csp, "connect-src"), SCHEME_FORMS);
    assert_eq!(directive(&csp, "frame-src"), ["'none'"]);
}

/// The CORS headers every answer to a frame carries for ranged reads.
fn assert_exposes_ranges(response: &Response<Vec<u8>>, what: &str) {
    assert_eq!(
        header_of(response, header::ACCESS_CONTROL_ALLOW_ORIGIN),
        "*",
        "{what}"
    );
    assert_eq!(
        header_of(response, header::ACCESS_CONTROL_EXPOSE_HEADERS),
        "Content-Range, Content-Length, Accept-Ranges",
        "{what}"
    );
}

#[test]
fn preflights_are_answered_with_range_allowed_and_the_range_headers_exposed() {
    for path in [
        format!("/_desk/file/{TOKEN}/Holiday%202026.mp4"),
        "/_desk/file/fedcba9876543210fedcba9876543210/a.mp4".to_owned(),
        "/example.hello/ui/index.html".to_owned(),
    ] {
        let mut asked = request("OPTIONS", &path, None);
        let headers = asked.headers_mut();
        headers.insert(
            header::ACCESS_CONTROL_REQUEST_METHOD,
            "GET".parse().unwrap(),
        );
        headers.insert(
            header::ACCESS_CONTROL_REQUEST_HEADERS,
            "range".parse().unwrap(),
        );
        let response = respond(&asked, &Fake::new("options"));
        assert_eq!(response.status(), StatusCode::NO_CONTENT, "{path}");
        assert_exposes_ranges(&response, &path);
        assert_eq!(
            header_of(&response, header::ACCESS_CONTROL_ALLOW_HEADERS),
            "Range",
            "{path}"
        );
        let methods = header_of(&response, header::ACCESS_CONTROL_ALLOW_METHODS);
        assert_eq!(methods, "GET, HEAD, OPTIONS", "{path}");
        let max_age = header_of(&response, header::ACCESS_CONTROL_MAX_AGE);
        assert!(max_age.parse::<u32>().is_ok_and(|age| age > 0), "{path}");
        assert!(
            response
                .headers()
                .get(header::CONTENT_SECURITY_POLICY)
                .is_none()
        );
        assert!(response.body().is_empty(), "{path}");
    }
}

#[test]
fn file_url_answers_expose_their_range_headers() {
    for range in [Some("bytes=10-19"), None, Some("bytes=200-")] {
        assert_exposes_ranges(&film(range), &format!("{range:?}"));
    }
    let unknown = get("/_desk/file/fedcba9876543210fedcba9876543210/a.mp4", None);
    assert_eq!(unknown.status(), StatusCode::NOT_FOUND);
    assert_exposes_ranges(&unknown, "unknown token");
}
