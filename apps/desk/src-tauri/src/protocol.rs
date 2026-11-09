//! The `desk-plugin` URL scheme in the Tauri shell: `desk_web::plugin_scheme` (#42), with the
//! bundles this binary embeds and the palette's own files.

use std::sync::Arc;

use desk_core::Core;
use desk_web::plugin_scheme::{self, Bundled};
use tauri::http::{Request, Response};
use tauri::{AppHandle, Manager};

pub const SCHEME: &str = plugin_scheme::SCHEME;

/// The SDK, the UI bundle and the shared sheets (`just build-sdk build-ui`), and the palette's UI.
static BUNDLED: Bundled = Bundled {
    sdk: include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../packages/plugin-sdk/dist/plugin-sdk.js"
    )),
    ui: include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../packages/ui/dist/ui.js"
    )),
    tokens: include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../packages/ui/dist/tokens.css"
    )),
    base: include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../packages/ui/dist/base.css"
    )),
    extra: crate::palette_assets::file,
};

/// Called off the main thread: a file URL reads from disk.
pub fn serve(app: &AppHandle, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let core = app.state::<Arc<Core>>();
    let response = plugin_scheme::respond(request, core.as_ref(), &BUNDLED);
    #[cfg(debug_assertions)]
    {
        let range = request.headers().get(tauri::http::header::RANGE);
        let range = range.and_then(|r| r.to_str().ok()).unwrap_or("-");
        eprintln!(
            "desk-plugin: {} {} {range}",
            response.status(),
            request.uri()
        );
    }
    response
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_ui_bundle_defines_its_elements() {
        assert!(super::BUNDLED.ui.contains("customElements"));
    }

    #[test]
    fn the_shell_may_frame_a_surface_host_in_both_forms() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let csp = config["app"]["security"]["csp"].as_str().unwrap();
        let mut frames = csp.split(';').map(str::trim);
        let frames = frames.find(|d| d.starts_with("frame-src ")).unwrap();
        let sources: Vec<&str> = frames.split_whitespace().skip(1).collect();
        // `desk-plugin://main.example-hello`; `http://desk-plugin.main.example-hello.localhost`,
        // which no source but a wildcard covers.
        assert!(sources.contains(&"desk-plugin:"), "{frames}");
        assert!(sources.contains(&"http://*.localhost"), "{frames}");
    }
}
