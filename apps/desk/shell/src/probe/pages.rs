//! The surface probe's pages, served on the `desk-plugin` scheme like plugin files, each on a
//! surface host of its own (so each gets a renderer of its own): a still page of one known colour,
//! a page that repaints every frame, a WebGPU page that clears to a known colour every frame, and a
//! still page whose one small square changes every frame.
//! Each names its renderer's process id, whether it has a parent and its origin in its title.

use std::io;

use desk_core::FileUrl;
use desk_web::plugin_scheme::Source;

/// The still page's colour (sRGB), and the WebGPU page's clear colour.
pub const COLOUR: [u8; 3] = [0x33, 0x66, 0xcc];
pub const WEBGPU: [u8; 3] = [0xcc, 0x33, 0x66];

/// The probe's plugins, by id: (id, page).
pub const PAGES: [(&str, &str); 4] = [
    ("probe.colour", COLOUR_PAGE),
    ("probe.anim", ANIM_PAGE),
    ("probe.webgpu", WEBGPU_PAGE),
    ("probe.dot", DOT_PAGE),
];

/// The URL of a probe plugin's page on its own surface host.
pub fn url(id: &str) -> String {
    let label = id.replace('-', "--").replace('.', "-");
    format!("desk-plugin://main.{label}/{id}/index.html")
}

const TITLE: &str = r#"<script>
  const say = (more) => (document.title = `pid:${globalThis.__deskNative?.pid ?? 0} parent:${window.parent !== window} origin:${self.origin} ${more ?? ""}`);
  say();
  window.parent.postMessage({ type: "probe:hello" }, "*");
</script>"#;

const COLOUR_PAGE: &str = concat!(
    r#"<!doctype html><meta charset="utf-8"><title>colour</title>"#,
    r#"<style>html,body{margin:0;height:100%;background:#3366cc}</style><body>"#
);

const ANIM_PAGE: &str = concat!(
    r#"<!doctype html><meta charset="utf-8"><title>anim</title>"#,
    r#"<style>html,body{margin:0;height:100%}</style><body><script>"#,
    r#"let n = 0; const tick = () => { n = (n + 7) % 256; document.body.style.background = `rgb(${n}, 120, 60)`; requestAnimationFrame(tick); }; requestAnimationFrame(tick);"#,
    r#"</script>"#
);

/// A still page with one small square that changes every frame: little damage per frame.
const DOT_PAGE: &str = concat!(
    r#"<!doctype html><meta charset="utf-8"><title>dot</title>"#,
    r#"<style>html,body{margin:0;height:100%;background:#202020}i{position:absolute;left:10px;top:10px;width:16px;height:16px}</style><body><i></i><script>"#,
    r#"const dot = document.querySelector("i"); let n = 0; const tick = () => { n = (n + 9) % 256; dot.style.background = `rgb(${n}, 200, 90)`; requestAnimationFrame(tick); }; requestAnimationFrame(tick);"#,
    r#"</script>"#
);

const WEBGPU_PAGE: &str = concat!(
    r#"<!doctype html><meta charset="utf-8"><title>webgpu</title>"#,
    r#"<style>html,body{margin:0;height:100%;background:#000}canvas{display:block;width:100vw;height:100vh}</style>"#,
    r#"<body><canvas></canvas><script type="module">"#,
    r#"const canvas = document.querySelector("canvas"); canvas.width = innerWidth * devicePixelRatio; canvas.height = innerHeight * devicePixelRatio;"#,
    r#"const adapter = await navigator.gpu?.requestAdapter(); const device = await adapter?.requestDevice();"#,
    r#"window.gpuInfo = adapter ? `gpu:${adapter.info.vendor}/${adapter.info.architecture} fallback:${adapter.isFallbackAdapter}` : "gpu:none";"#,
    r#"if (device) { const context = canvas.getContext("webgpu"); const format = navigator.gpu.getPreferredCanvasFormat(); context.configure({ device, format, alphaMode: "opaque" });"#,
    r#"const frame = () => { const encoder = device.createCommandEncoder(); const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0.8, g: 0.2, b: 0.4, a: 1 } }] }); pass.end(); device.queue.submit([encoder.finish()]); requestAnimationFrame(frame); }; requestAnimationFrame(frame); }"#,
    r#"</script>"#
);

/// The probe's files for the scheme: its pages, nothing else.
pub struct Pages;

impl Source for Pages {
    fn plugin_file(&self, id: &str, path: &str) -> io::Result<Vec<u8>> {
        let page = PAGES.iter().find(|(known, _)| *known == id);
        match (page, path) {
            (Some((_, page)), "index.html") => {
                let script = if id == "probe.webgpu" {
                    TITLE.replace(
                        "say();",
                        "say(); setTimeout(() => say(window.gpuInfo), 1500);",
                    )
                } else {
                    TITLE.to_owned()
                };
                Ok(format!("{page}{script}").into_bytes())
            }
            _ => Err(io::Error::from(io::ErrorKind::NotFound)),
        }
    }

    fn file_url(&self, _token: &str) -> Option<FileUrl> {
        None
    }

    fn library(&self, _id: &str) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::{Pages, url};
    use desk_web::plugin_scheme::Source;

    #[test]
    fn each_probe_page_is_on_a_surface_host_of_its_own() {
        assert_eq!(
            url("probe.colour"),
            "desk-plugin://main.probe-colour/probe.colour/index.html"
        );
        assert!(crate::web_host::relay::surface_host(&url("probe.webgpu")).is_some());
        let page = Pages.plugin_file("probe.colour", "index.html").unwrap();
        assert!(String::from_utf8_lossy(&page).contains("#3366cc"));
        assert!(Pages.plugin_file("probe.colour", "other.js").is_err());
        assert!(Pages.plugin_file("x.y", "index.html").is_err());
    }
}
