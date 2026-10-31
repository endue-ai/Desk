//! The `desk-plugin` URL scheme: plugin files by id and path, the plugin SDK
//! (`/_desk/plugin-sdk.js`) and the `@endue-ai/ui` bundle (`/_desk/ui.js`), both embedded.
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
const UI_PATH: &str = "_desk/ui.js";
const UI: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../packages/ui/dist/ui.js"
));

const SOURCES: &str = "desk-plugin: http://desk-plugin.localhost";

pub fn serve(app: &AppHandle, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let response = respond(request.uri().path(), |id, file| {
        app.state::<Arc<Core>>().plugin_file(id, file)
    });
    #[cfg(debug_assertions)]
    eprintln!("desk-plugin: {} {}", response.status(), request.uri());
    response
}

/// The response for a URL path: one of the embedded bundles, or a plugin's file.
fn respond(
    path: &str,
    plugin_file: impl Fn(&str, &str) -> io::Result<Vec<u8>>,
) -> Response<Vec<u8>> {
    let path = decode(path.trim_start_matches('/'));
    let body = match path.as_str() {
        SDK_PATH => Ok(SDK.as_bytes().to_vec()),
        UI_PATH => Ok(UI.as_bytes().to_vec()),
        _ => match path.split_once('/') {
            Some((id, file)) => plugin_file(id, file),
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

#[cfg(test)]
mod tests {
    use super::*;

    fn missing(_id: &str, _file: &str) -> io::Result<Vec<u8>> {
        Err(io::Error::from(io::ErrorKind::NotFound))
    }

    #[test]
    fn the_ui_bundle_and_the_sdk_are_served_as_javascript() {
        for (path, bundle) in [("/_desk/ui.js", UI), ("/_desk/plugin-sdk.js", SDK)] {
            let response = respond(path, missing);
            assert_eq!(response.status(), StatusCode::OK, "{path}");
            let kind = response.headers().get(header::CONTENT_TYPE).unwrap();
            assert_eq!(kind, "text/javascript; charset=utf-8", "{path}");
            assert!(response.headers().get(header::CONTENT_SECURITY_POLICY).is_none());
            assert_eq!(response.body().as_slice(), bundle.as_bytes(), "{path}");
        }
        assert!(UI.contains("customElements"), "the ui bundle defines its elements");
    }

    #[test]
    fn plugin_files_come_from_the_core_and_missing_ones_are_404() {
        let served = respond("/example.hello/ui/index.html", |id, file| {
            Ok(format!("{id} {file}").into_bytes())
        });
        assert_eq!(served.body().as_slice(), b"example.hello ui/index.html");
        assert!(served.headers().get(header::CONTENT_SECURITY_POLICY).is_some());
        assert_eq!(respond("/_desk/other.js", missing).status(), StatusCode::NOT_FOUND);
    }
}
