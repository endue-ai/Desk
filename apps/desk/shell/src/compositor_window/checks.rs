//! What compositor mode tells checks (development builds, #52, #81): the composed frame as a PNG,
//! read back from the GPU (`compositor_capture`), and what every surface painted, where it is drawn
//! and which parts of it nothing covers, the windows the compositor hosts and the live set
//! (`compositor_stats`).

use desk_wm::host::{intersect, subtract};
use serde_json::{Value, json};

use super::CompositorWindow;

/// What the event loop did so far (`pump::Counts`): its turns, CEF's work calls, the time those
/// took and how many ran 5 ms or more (CEF's busy-wait, ADR 0159), for checks at rest (#147).
fn pump(counts: crate::pump::Counts) -> Value {
    json!({ "turns": counts.turns, "works": counts.works,
        "work_ms": counts.work.as_secs_f64() * 1000.0, "long": counts.long })
}

/// `[x, y, w, h]`.
fn quad(r: desk_wm::Rect) -> [f64; 4] {
    [r.x, r.y, r.w, r.h]
}

impl CompositorWindow {
    /// The composed frame as a PNG at `path` (development builds: checks and screenshots).
    pub fn capture(&mut self, path: &str) -> Result<Value, String> {
        self.compose();
        let rgba = self.shared.lock().read(&self.scene).ok_or("no readback")?;
        let (w, h) = self.scene.viewport();
        let file = std::fs::File::create(path).map_err(|e| e.to_string())?;
        let mut encoder = png::Encoder::new(std::io::BufWriter::new(file), w, h);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(&rgba).map_err(|e| e.to_string())?;
        Ok(json!({ "path": path, "width": w, "height": h, "nodes": self.scene.len() }))
    }

    /// Where plugin `plugin` is drawn, in the window's logical pixels, and the parts of it no
    /// window above covers: its pane's body in a window, or where the page lays it out.
    fn placed(&self, plugin: &str) -> Option<(desk_wm::Rect, Vec<desk_wm::Rect>)> {
        let report = self.hosted.report()?;
        if let Some(p) = (report.frames.iter().find(|f| f.plugin == plugin)).and_then(|f| f.place) {
            let at = desk_wm::Rect::new(p.x, p.y, p.width, p.height);
            return Some((at, if p.shown { vec![at] } else { Vec::new() }));
        }
        let plan = self.hosted.plan()?;
        let screen = desk_wm::Rect::new(0.0, 0.0, plan.screen.w, plan.screen.h);
        let (i, pane) = (plan.windows.iter().enumerate()).rev().find_map(|(i, w)| {
            let pane = w
                .panes
                .iter()
                .find(|p| p.plugin.as_deref() == Some(plugin))?;
            Some((i, pane))
        })?;
        let above: Vec<desk_wm::Rect> = plan.windows[i + 1..].iter().map(|w| w.rect).collect();
        let open = intersect(pane.body, screen).map_or_else(Vec::new, |b| subtract(b, &above));
        Some((pane.body, open))
    }

    /// Hold the window manager's clock (`{ "hold": true }` where it is now, `{ "at": ms }` there,
    /// `{ "at": null }` lets it run) and draw again; answers where it is now, in milliseconds.
    pub fn clock_check(&mut self, args: &Value) -> Value {
        let now = std::time::Instant::now();
        match args.get("at") {
            Some(Value::Null) => self.hosted.hold_clock(None),
            Some(at) => self.hosted.hold_clock(at.as_f64()),
            None if args.get("hold").and_then(Value::as_bool) == Some(true) => {
                let at = self.hosted.ms(now);
                self.hosted.hold_clock(Some(at));
            }
            None => {}
        }
        self.shared.lock().dirty = true;
        json!({ "now": self.hosted.ms(now) })
    }

    /// What each surface did, and the hosted desk, for checks (development builds).
    pub fn stats(&self) -> Value {
        let composed = self.shared.lock();
        let mut surfaces = serde_json::Map::new();
        for (surface, plugin, asleep) in self.hosted.surfaces().made() {
            let (counts, state) = self
                .host
                .counts(&surface)
                .map_or((json!(null), json!("none")), |(c, s, _)| {
                    (json!(c), json!(format!("{s:?}")))
                });
            let attached = composed.attached.get(&surface).copied().unwrap_or_default();
            let texture = composed
                .texture_of(&surface)
                .and_then(|id| composed.frames.size(id));
            let placed = self.placed(&plugin);
            let pieces: Vec<[f64; 4]> = placed
                .as_ref()
                .map(|(_, open)| open.iter().copied().map(quad).collect())
                .unwrap_or_default();
            let loads = self.hosted.frame(&plugin).map(|f| f.loads);
            surfaces.insert(
                surface,
                json!({ "plugin": plugin, "state": state, "asleep": asleep, "counts": counts,
                "attached": attached.0, "refused": attached.1, "texture": texture,
                "pieces": pieces, "loads": loads, "rect": placed.map(|(at, _)| quad(at)) }),
            );
        }
        let windows: Vec<Value> = (self.hosted.plan().map(|p| p.windows.as_slice()))
            .unwrap_or_default()
            .iter()
            .map(|w| {
                let panes: Vec<Value> = (w.panes.iter())
                    .map(|p| json!({ "id": p.id, "plugin": p.plugin, "rect": quad(p.rect) }))
                    .collect();
                json!({ "id": w.id, "rect": quad(w.rect), "focused": w.focused, "title": w.title,
                    "panes": panes })
            })
            .collect();
        let page = self.page.lock().counts.clone();
        // The system layer (ADR 0160): the system surfaces and their callers, the desk's parts the
        // last scene drew whole, and the plugin surfaces the page lays out there, by layer.
        let system: Vec<Value> = (desk_web::sender::System::ALL.iter())
            .map(|s| json!({ "id": s.id(), "role": format!("{:?}", s.role()), "caller": s.caller() }))
            .collect();
        let layers: Vec<Value> = (self.hosted.report().map(|r| r.frames.as_slice()))
            .unwrap_or_default()
            .iter()
            .filter_map(|f| {
                f.place.map(|p| {
                    json!({ "plugin": f.plugin, "shown": p.shown,
                "layer": format!("{:?}", p.layer).to_lowercase() })
                })
            })
            .collect();
        json!({
            "page": page,
            "system": { "surfaces": system, "parts": self.parts.0, "order": self.parts.1, "plugins": layers },
            "surfaces": surfaces,
            "windows": windows,
            "live": self.hosted.live(),
            "browsers": self.host.browsers(),
            "native": self.native.stats(),
            "relayed": self.relay.counts(),
            "composed": self.composed,
            "presented": self.presented,
            "pump": pump(self.desk.pump.counts()),
            "slow_presents": self.slow_presents,
            "occluded": self.occluded,
            "presenting": self.gpu.presents(),
            "adapter": format!("{} ({:?})", self.gpu.adapter.name, self.gpu.adapter.backend),
            "wm": self.wm_state(),
        })
    }
}
