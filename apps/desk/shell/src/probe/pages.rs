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

/// The probe's plugins, by id: (id, page). Four are the isolation and budget gates' (#58,
/// `gates.rs`, `input_gate.rs`), the last the accessibility run's (#57, `a11y.rs`).
pub const PAGES: [(&str, &str); 10] = [
    ("probe.colour", COLOUR_PAGE),
    ("probe.anim", ANIM_PAGE),
    ("probe.webgpu", WEBGPU_PAGE),
    ("probe.dot", DOT_PAGE),
    ("probe.light", LIGHT_PAGE),
    ("probe.busy", BUSY_PAGE),
    ("probe.hog", HOG_PAGE),
    ("probe.click", CLICK_PAGE),
    ("probe.a11y", A11Y_PAGE),
    ("probe.later", LATER_PAGE),
];

/// A still page that changes its colour on its own every 2.5 s, by a timer: nothing the desk sends
/// it. Its title names each change and when it came (ms since the Unix epoch), for the rest run
/// (#134) to time the change to its paint.
const LATER_PAGE: &str = concat!(
    r#"<!doctype html><meta charset="utf-8"><title>later</title>"#,
    r#"<style>html,body{margin:0;height:100%;background:#3399cc}</style><body><script>"#,
    r#"let changes = 0; const change = () => { changes += 1;"#,
    r##"document.body.style.background = changes % 2 ? "#cc9933" : "#3399cc";"##,
    r#"if (typeof say === "function") say(`changed:${changes}:${Date.now()}`); setTimeout(change, 2500); };"#,
    r#"setTimeout(change, 2500);"#,
    r#"</script>"#
);

/// A plugin's ordinary controls at known places (logical pixels): a heading, a text field, a
/// button that counts its clicks in the title, a checkbox and a scrolled list of twenty items.
const A11Y_PAGE: &str = concat!(
    r#"<!doctype html><html lang="en"><meta charset="utf-8"><title>a11y</title><style>"#,
    r#"html,body{margin:0;font:16px/1 system-ui,sans-serif}body>*{position:absolute;margin:0;box-sizing:border-box}"#,
    r#"h1{left:16px;top:8px;height:28px;font-size:20px}#field{left:16px;top:60px;width:160px;height:28px}"#,
    r#"#add{left:200px;top:60px;width:80px;height:28px}#milk{left:16px;top:110px}"#,
    r#"#list{left:16px;top:150px;width:200px;height:100px;overflow:auto}#list div{height:30px}"#,
    r#"</style><h1>Shopping</h1><input id="field" aria-label="New item" placeholder="Add an item">"#,
    r#"<button id="add">Add</button><label id="milk"><input type="checkbox" checked> Milk</label>"#,
    r#"<div id="list" role="list" aria-label="Items" tabindex="0"></div><script>"#,
    r#"const list = document.getElementById("list"); for (let i = 1; i <= 20; i++) { const item = document.createElement("div");"#,
    r#"item.setAttribute("role", "listitem"); item.textContent = `Item ${i}`; list.append(item); }"#,
    r#"let clicks = 0; document.getElementById("add").addEventListener("click", () => { clicks += 1; say(`clicks:${clicks}`); });"#,
    r#"</script>"#
);

/// A still page that changes colour on every pointer press and names the presses in its title.
const CLICK_PAGE: &str = concat!(
    r#"<!doctype html><meta charset="utf-8"><title>click</title>"#,
    r#"<style>html,body{margin:0;height:100%;background:#3366cc}</style><body><script>"#,
    r#"let clicks = 0; addEventListener("pointerdown", () => { clicks += 1;"#,
    r##"document.body.style.background = clicks % 2 ? "#cc3366" : "#3366cc"; if (typeof say === "function") say(`clicks:${clicks}`); });"##,
    r#"</script>"#
);

/// The PoC's light page (`spikes/compositor/pages/light.html`), which #35 measured memory with: a
/// card, a spinning square and a canvas redrawn every frame.
const LIGHT_PAGE: &str = concat!(
    r#"<!doctype html><meta charset="utf-8"><title>light</title><style>"#,
    r#"html,body{margin:0;height:100%;font:28px/1.3 system-ui,sans-serif;color:#f5f5f7}"#,
    r#"body{background:linear-gradient(135deg,#1d2b64,#f8cdda);display:grid;place-items:center}"#,
    r#".card{padding:32px 40px;border-radius:20px;background:rgba(0,0,0,.35);text-align:center}"#,
    r#".spin{width:80px;height:80px;margin:16px auto;border-radius:16px;background:#ffd166;animation:spin 2s linear infinite}"#,
    r#"@keyframes spin{to{transform:rotate(360deg)}}canvas{display:block;margin:0 auto;border-radius:12px;background:#0b132b}"#,
    r#"</style><div class="card"><div>Off-screen CEF surface · 데스크 합성기</div><div class="spin"></div>"#,
    r#"<canvas id="c" width="360" height="120"></canvas><small id="t">frame 0</small></div><script>"#,
    r#"const ctx = document.getElementById("c").getContext("2d"); const label = document.getElementById("t"); let n = 0;"#,
    r##"const tick = (now) => { n += 1; ctx.fillStyle = "#0b132b"; ctx.fillRect(0, 0, 360, 120); ctx.fillStyle = "#06d6a0";"##,
    r#"ctx.beginPath(); ctx.arc(60 + ((now / 5) % 240), 60, 26, 0, Math.PI * 2); ctx.fill(); label.textContent = `frame ${n}`; requestAnimationFrame(tick); };"#,
    r#"requestAnimationFrame(tick);</script>"#
);

/// A page that animates until told `spin()`, then never returns from its main thread again.
const BUSY_PAGE: &str = concat!(
    r#"<!doctype html><meta charset="utf-8"><title>busy</title>"#,
    r#"<style>html,body{margin:0;height:100%;background:#66cc33}</style><body><script>"#,
    r#"globalThis.spin = () => { for (;;) {} };"#,
    r#"let n = 0; const tick = () => { n = (n + 5) % 256; document.body.style.background = `rgb(102, 204, ${n})`; requestAnimationFrame(tick); }; requestAnimationFrame(tick);"#,
    r#"</script>"#
);

/// A page that keeps allocating (16 MiB every fourth frame, each byte written so it is resident)
/// and holds it all, up to 1.5 GiB, naming the MiB it holds in its title.
const HOG_PAGE: &str = concat!(
    r#"<!doctype html><meta charset="utf-8"><title>hog</title>"#,
    r#"<style>html,body{margin:0;height:100%;background:#cc6633}</style><body><script>"#,
    r#"const held = []; let frame = 0; let mb = 0;"#,
    r#"const tick = () => { frame += 1; if (frame % 4 === 0 && mb < 1536) { const block = new Uint8Array(16 << 20); block.fill(frame & 255); held.push(block); mb += 16;"#,
    r#"if (typeof say === "function") say(`mb:${mb}`); } document.body.style.background = `rgb(204, ${frame % 256}, 51)`; requestAnimationFrame(tick); };"#,
    r#"requestAnimationFrame(tick);"#,
    r#"</script>"#
);

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
