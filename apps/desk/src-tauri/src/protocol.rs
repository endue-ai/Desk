//! The `desk-plugin` URL scheme: plugin files by id and path, and the plugin SDK.
//!
//! macOS and Linux see `desk-plugin://localhost/<id>/<path>`; Windows sees
//! `http://desk-plugin.localhost/<id>/<path>`. Plugin frames are sandboxed (opaque origin), so
//! responses allow any origin, and HTML gets a CSP that blocks network access: plugins reach the
//! network only through the bridge's net.fetch, under its permission check.

use std::io;
use std::sync::Arc;

use desk_core::Core;
use tauri::http::{Request, Response, StatusCode, header};
use tauri::{AppHandle, Manager};

pub const SCHEME: &str = "desk-plugin";

const SDK_PATH: &str = "_desk/plugin-sdk.js";
const SDK: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../packages/plugin-sdk/dist/plugin-sdk.js"
));

const SOURCES: &str = "desk-plugin: http://desk-plugin.localhost";

pub fn serve(app: &AppHandle, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let path = decode(request.uri().path().trim_start_matches('/'));
    let body = if path == SDK_PATH {
        Ok(SDK.as_bytes().to_vec())
    } else if let Some(bytes) = crate::palette_assets::file(&path) {
        Ok(bytes.to_vec())
    } else {
        match path.split_once('/') {
            Some((id, file)) => app.state::<Arc<Core>>().plugin_file(id, file),
            None => Err(io::Error::from(io::ErrorKind::NotFound)),
        }
    };
    #[cfg(debug_assertions)]
    eprintln!(
        "desk-plugin: {} {}",
        if body.is_ok() { 200 } else { 404 },
        request.uri()
    );
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
         img-src {SOURCES} data:; font-src {SOURCES}; connect-src 'none'; frame-src 'none'; form-action 'none'"
    )
}

fn mime_type(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or_default() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "woff2" => "font/woff2",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
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
