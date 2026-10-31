//! The `desk-plugin` URL scheme: plugin files by id and path, the plugin SDK
//! (`/_desk/plugin-sdk.js`) and the `@endue-ai/ui` bundle (`/_desk/ui.js`), both embedded, and the
//! files fs.url hands out (`/_desk/file/<token>/<file name>`), with HTTP ranges (ADR 0041).
//!
//! macOS and Linux see `desk-plugin://localhost/<id>/<path>`; Windows sees
//! `http://desk-plugin.localhost/<id>/<path>`. Plugin frames are sandboxed (opaque origin), so
//! responses allow any origin, preflights are answered (`Range` may be sent; `Content-Range` and
//! its kin may be read), and HTML gets a CSP that blocks network access: plugins reach the network
//! only through the bridge's net.fetch, under its permission check, while `fetch` reaches the scheme
//! itself (file URLs). Scripts, media, images and fonts load from the scheme, media and images also
//! from `blob:` and `data:`; workers start from `blob:` and WebAssembly may compile (ADR 0048).

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
/// The plugin frames' CSP with `{sources}` for the scheme in both forms; the runtime's e2e server
/// serves its plugin frames under the same file, with its own origin as the sources.
const PLUGIN_CSP: &str = include_str!("plugin-csp.txt");

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
    if request.method() == Method::OPTIONS {
        return preflight();
    }
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
    PLUGIN_CSP.trim().replace("{sources}", SOURCES)
}

/// The answer to a CORS preflight, for any path: a frame's `fetch` with a `Range` header asks first.
fn preflight() -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::NO_CONTENT)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, HEAD, OPTIONS")
        .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "Range")
        .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, file_urls::EXPOSED)
        .header(header::ACCESS_CONTROL_MAX_AGE, "600")
        .body(Vec::new())
        .unwrap_or_default()
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
mod tests;
