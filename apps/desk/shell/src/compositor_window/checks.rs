//! What compositor mode tells checks (development builds, #52): the composed frame as a PNG, read
//! back from the GPU (`compositor_capture`), and what every surface painted (`compositor_stats`).

use serde_json::{Value, json};

use super::CompositorWindow;

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
        Ok(json!({ "path": path, "width": w, "height": h, "quads": self.scene.len() }))
    }

    /// What each surface did, for checks (development builds).
    pub fn stats(&self) -> Value {
        let composed = self.shared.lock();
        let mut surfaces = serde_json::Map::new();
        for (surface, asleep) in self.layout.surfaces() {
            let (counts, state, plugin) = self
                .host
                .counts(&surface)
                .map_or((json!(null), json!("none"), json!(null)), |(c, s, p)| {
                    (json!(c), json!(format!("{s:?}")), json!(p))
                });
            let attached = composed.attached.get(&surface).copied().unwrap_or_default();
            let texture = composed
                .texture_of(&surface)
                .and_then(|id| composed.frames.size(id));
            let placed = self.layout.placed.iter().find(|p| p.host == surface);
            let pieces: Vec<[f64; 4]> = placed
                .map(|p| {
                    p.pieces
                        .iter()
                        .map(|b| [b.x, b.y, b.width, b.height])
                        .collect()
                })
                .unwrap_or_default();
            surfaces.insert(
                surface,
                json!({ "plugin": plugin, "state": state, "asleep": asleep,
                "counts": counts, "attached": attached.0, "refused": attached.1, "texture": texture,
                "pieces": pieces, "loads": placed.map(|p| p.loads),
                "rect": placed.map(|p| [p.rect.x, p.rect.y, p.rect.width, p.rect.height]) }),
            );
        }
        let page = self.page.lock().counts.clone();
        json!({
            "page": page,
            "surfaces": surfaces,
            "browsers": self.host.browsers(),
            "relayed": self.relay.counts(),
            "presented": self.presented,
            "slow_presents": self.slow_presents,
            "adapter": format!("{} ({:?})", self.gpu.adapter.name, self.gpu.adapter.backend),
        })
    }
}
