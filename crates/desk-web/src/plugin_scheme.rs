//! The `desk-plugin` URL scheme, for every shell (moved from the Tauri shell in #42; the CEF shell
//! adapts it to CEF's resource handlers): plugin files by id and path, the plugin SDK
//! (`/_desk/plugin-sdk.js`), the UI bundle and shared sheets (`/_desk/ui.js`, `tokens.css`, `base.css`), and the
//! files fs.url hands out (`/_desk/file/<token>/<file name>`), with HTTP ranges (ADR 0041).
//!
//! Every plugin surface loads from a host of its own (#36, `protocol/hosts.rs`):
//! `desk-plugin://<surface>.<plugin label>/<id>/<path>` on macOS and Linux,
//! `http://desk-plugin.<surface>.<plugin label>.localhost/<id>/<path>` on Windows. A path under
//! another plugin's id is refused there with 403, unless that plugin is a library (ADR 0049); the
//! `/_desk/` files load on every host. The shared host, `desk-plugin://localhost` and
//! `http://desk-plugin.localhost`, serves the desk's own pages and the files it loads itself (theme
//! fonts). Plugin frames are sandboxed (opaque origin), so responses allow any origin, preflights
//! are answered (`Range` may be sent; `Content-Range` and its kin may be read), and HTML gets a CSP
//! that blocks network access: plugins reach the network only through the bridge's net.fetch, under
//! its permission check, while `fetch` reaches the scheme itself (file URLs). Scripts, media, images
//! and fonts load from the scheme, media and images also from `blob:` and `data:`; workers start
//! from `blob:` and WebAssembly may compile (ADR 0048).

use std::io;

use desk_bridge::PluginKind;
use desk_core::{Core, FileUrl, media_type};
use http::{Method, Request, Response, StatusCode, header};

use crate::file_urls;
use hosts::Host;

pub mod hosts;

pub const SCHEME: &str = "desk-plugin";

const SDK_PATH: &str = "_desk/plugin-sdk.js";
const UI_PATH: &str = "_desk/ui.js";
const TOKENS_PATH: &str = "_desk/tokens.css";
const BASE_PATH: &str = "_desk/base.css";
const FILE_PREFIX: &str = "_desk/file/";

/// The desk's own files every plugin page may load, built by `just build-sdk build-ui` and embedded
/// by the shell that serves them (so this crate builds without them).
pub struct Bundled {
    /// `packages/plugin-sdk/dist/plugin-sdk.js`
    pub sdk: &'static str,
    /// `packages/ui/dist/ui.js`
    pub ui: &'static str,
    /// `packages/ui/dist/tokens.css`
    pub tokens: &'static str,
    /// `packages/ui/dist/base.css`
    pub base: &'static str,
    /// A shell's own files on the scheme (the Tauri palette's), by path.
    pub extra: fn(&str) -> Option<&'static [u8]>,
}

/// The plugin frames' CSP with `{sources}` for the scheme in both forms and a surface's own origin
/// (`Host::sources`); the runtime's e2e server serves its plugin frames under the same file, with its
/// own origins as the sources.
const PLUGIN_CSP: &str = include_str!("plugin-csp.txt");

/// What the scheme serves from the core: plugin files, and the file a URL token names.
pub trait Source {
    fn plugin_file(&self, id: &str, path: &str) -> io::Result<Vec<u8>>;
    fn file_url(&self, token: &str) -> Option<FileUrl>;
    /// Whether `id` is a library: its modules run in the frame of the plugin that imports them, so
    /// every surface's host serves them (ADR 0049).
    fn library(&self, id: &str) -> bool;
    /// The other plugins whose files `id`'s pages load (its manifest's `imports`): its surfaces'
    /// hosts serve them too, their code running as `id`.
    fn imports(&self, id: &str) -> Vec<String> {
        let _ = id;
        Vec::new()
    }
}

impl Source for Core {
    fn plugin_file(&self, id: &str, path: &str) -> io::Result<Vec<u8>> {
        Core::plugin_file(self, id, path)
    }

    fn file_url(&self, token: &str) -> Option<FileUrl> {
        Core::file_url(self, token)
    }

    fn library(&self, id: &str) -> bool {
        let kind = |info: &desk_bridge::PluginInfo| info.manifest.as_ref().map(|m| m.kind);
        let plugins = self.plugins();
        let found = plugins.iter().find(|info| info.id == id);
        found.and_then(kind) == Some(PluginKind::Library)
    }

    fn imports(&self, id: &str) -> Vec<String> {
        let plugins = self.plugins();
        let found = plugins.iter().find(|info| info.id == id);
        let manifest = found.and_then(|info| info.manifest.as_ref());
        manifest
            .and_then(|m| m.imports.clone())
            .unwrap_or_default()
            .into_iter()
            .map(|id| id.to_string())
            .collect()
    }
}

/// The response for a request: a file URL, one of the embedded bundles, or a plugin's file. A host
/// that is neither the shared one nor a surface's is refused, and so is a plugin's path on another
/// plugin's surface.
pub fn respond(
    request: &Request<Vec<u8>>,
    source: &impl Source,
    bundled: &Bundled,
) -> Response<Vec<u8>> {
    let Some(host) = Host::parse(request.uri().host()) else {
        return Response::builder()
            .status(StatusCode::FORBIDDEN)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(Vec::new())
            .unwrap_or_default();
    };
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
        SDK_PATH => Ok(bundled.sdk.as_bytes().to_vec()),
        UI_PATH => Ok(bundled.ui.as_bytes().to_vec()),
        TOKENS_PATH => Ok(bundled.tokens.as_bytes().to_vec()),
        BASE_PATH => Ok(bundled.base.as_bytes().to_vec()),
        _ if (bundled.extra)(&path).is_some() => {
            Ok((bundled.extra)(&path).unwrap_or_default().to_vec())
        }
        _ => match path.split_once('/') {
            Some((id, file))
                if host.serves(id) || source.library(id) || imported(&host, id, source) =>
            {
                source.plugin_file(id, file)
            }
            Some(_) => Err(io::Error::from(io::ErrorKind::PermissionDenied)),
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
                response = response.header(header::CONTENT_SECURITY_POLICY, plugin_csp(&host));
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

/// Whether the plugin whose surface `host` is names `id` among its imports.
fn imported(host: &Host, id: &str, source: &impl Source) -> bool {
    match host {
        Host::Surface { plugin, .. } => source.imports(plugin).iter().any(|i| i == id),
        Host::Shared => false,
    }
}

fn plugin_csp(host: &Host) -> String {
    PLUGIN_CSP.trim().replace("{sources}", &host.sources())
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

/// Bundles for tests: each one's name as its content.
#[cfg(test)]
pub(crate) const TEST_BUNDLED: Bundled = Bundled {
    sdk: "plugin-sdk.js",
    ui: "ui.js customElements",
    tokens: ":root{--tokens:1}",
    base: "body{base:1}",
    extra: |path| (path == "_desk/palette/index.html").then_some(b"palette".as_slice()),
};

#[cfg(test)]
mod shared_sheets_tests {
    use super::*;

    struct NoFiles;
    impl Source for NoFiles {
        fn plugin_file(&self, _: &str, _: &str) -> io::Result<Vec<u8>> {
            Err(io::ErrorKind::NotFound.into())
        }
        fn file_url(&self, _: &str) -> Option<FileUrl> {
            None
        }
        fn library(&self, _: &str) -> bool {
            false
        }
    }

    #[test]
    fn shared_sheets_are_embedded_css_with_frame_cors() {
        for (path, content) in [
            (TOKENS_PATH, TEST_BUNDLED.tokens),
            (BASE_PATH, TEST_BUNDLED.base),
        ] {
            let request = Request::builder()
                .uri(format!("desk-plugin://localhost/{path}"))
                .body(vec![])
                .unwrap();
            let response = respond(&request, &NoFiles, &TEST_BUNDLED);
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(
                response.headers()[header::CONTENT_TYPE],
                "text/css; charset=utf-8"
            );
            assert_eq!(response.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN], "*");
            assert_eq!(response.body(), content.as_bytes());
        }
    }
}
