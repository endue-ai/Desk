//! What the shell page reports (`compositor_desk`, ADR 0151): what only the page knows of the
//! desk, whose windows `desk-wm` holds (#83) and publishes: each plugin frame's document and
//! state, the titles of its own views, the top chips' edges, the live budget's two settings, what
//! a window without a live frame says (the page's copy, in the desk's language), the last desk it
//! took and laid out, and where it lays a held window out.

use std::collections::BTreeMap;

use desk_wm::{FrameState, TopChrome};
use serde::Deserialize;

/// What a window shows where its plugin has no live frame: its title, a line, its actions.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct Card {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub line: String,
    #[serde(default)]
    pub actions: Vec<String>,
}

/// One plugin surface's frame in the page.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct FrameReport {
    pub plugin: String,
    /// The surface's host, `<surface>.<plugin label>`.
    pub host: String,
    /// The document its page shows.
    pub src: String,
    /// How many times the frame loaded in the page.
    #[serde(default)]
    pub loads: u64,
    #[serde(default)]
    pub state: FrameState,
    /// What its window says while the frame is away or not answering.
    #[serde(default)]
    pub card: Option<Card>,
    /// A surface the page places itself, outside every window (an overlay, an edge bar, #55):
    /// where its frame is on the page.
    #[serde(default)]
    pub place: Option<Place>,
}

/// Where the page lays out a surface of its own system layer, in CSS pixels.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq)]
pub struct Place {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// Shown: in the page and not hidden.
    #[serde(default)]
    pub shown: bool,
    #[serde(default)]
    pub layer: Layer,
}

/// Where in the system layer a plugin surface of the page's goes (ADR 0160): an edge bar under the
/// page's own parts (its bars and pills float above it), an overlay (the palette, the first run, a
/// permission prompt) above them, as the page stacks them.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Layer {
    #[default]
    Edge,
    Overlay,
}

/// A part of the desk's system surface where the page shows it (`desk_web::sender::PARTS`).
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct PartReport {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl PartReport {
    /// Its box, when it names a part the compositor knows and has a size.
    pub fn known(&self) -> Option<desk_wm::Rect> {
        desk_web::sender::part(&self.id)?;
        let finite = [self.x, self.y, self.width, self.height]
            .iter()
            .all(|v| v.is_finite());
        (finite && self.width > 0.0 && self.height > 0.0)
            .then(|| desk_wm::Rect::new(self.x, self.y, self.width, self.height))
    }
}

/// The live budget's settings (`desk.surfaces.live`, `desk.display.unload-after`).
#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BudgetSettings {
    pub live: usize,
    #[serde(default)]
    pub after_ms: f64,
}

impl Default for BudgetSettings {
    fn default() -> Self {
        BudgetSettings {
            live: 8,
            after_ms: 0.0,
        }
    }
}

/// Labels for the placeholders the compositor draws itself.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct Copy {
    /// A frame that died, while it loads again.
    #[serde(default)]
    pub crashed: String,
    /// A frame not painted yet.
    #[serde(default)]
    pub loading: String,
}

/// The shell page's report.
#[derive(Clone, Debug, Deserialize)]
pub struct DeskReport {
    /// Counts up with every report; an older one arriving late is ignored.
    pub seq: u64,
    /// The page's size in CSS pixels.
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub frames: Vec<FrameReport>,
    /// The parts of its system layer it shows, each drawn whole above every window (ADR 0160).
    #[serde(default)]
    pub parts: Vec<PartReport>,
    /// The titles of the page's own views, by view.
    #[serde(default)]
    pub titles: BTreeMap<String, String>,
    #[serde(default)]
    pub top: TopChrome,
    #[serde(default)]
    pub budget: BudgetSettings,
    #[serde(default)]
    pub copy: Copy,
    /// The last desk `desk-wm` published that the page took and laid out (`desk://compositor-wm`).
    #[serde(default)]
    pub applied: u64,
    /// The window the page lays out where a gesture holds it (`desk://compositor-held`).
    #[serde(default)]
    pub held: Option<Held>,
}

/// Where the page lays a held window out, in CSS pixels.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Held {
    pub window: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl desk_wm::Seen for DeskReport {
    fn title(&self, view: &str) -> Option<String> {
        self.titles.get(view).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::{DeskReport, Layer};
    use desk_wm::{FrameState, Seen};
    use serde_json::json;

    #[test]
    fn a_report_reads_the_pages_frames_and_titles() {
        let report: DeskReport = serde_json::from_value(json!({
            "seq": 3, "width": 1280, "height": 800, "applied": 2,
            "frames": [{ "plugin": "e2e.hello", "host": "main.e2e-hello",
                "src": "desk-plugin://main.e2e-hello/index.html", "loads": 2, "state": "late",
                "card": { "title": "Not responding", "line": "Hello has not answered", "actions": ["Wait", "Stop"] } }],
            "titles": { "launcher": "Launcher" },
            "top": { "left": 300, "right": 260 },
            "budget": { "live": 4, "afterMs": 300000 }
        }))
        .unwrap();
        assert_eq!(report.applied, 2);
        assert_eq!(report.frames[0].state, FrameState::Late);
        assert_eq!(report.frames[0].card.as_ref().unwrap().actions.len(), 2);
        assert_eq!(report.title("launcher").as_deref(), Some("Launcher"));
        assert_eq!((report.budget.live, report.top.left), (4, Some(300.0)));
    }

    #[test]
    fn a_report_names_its_system_parts_and_its_overlays_layer() {
        let report: DeskReport = serde_json::from_value(json!({
            "seq": 1, "width": 1280, "height": 800,
            "frames": [{ "plugin": "desk.palette", "host": "main.desk-palette",
                "src": "desk-plugin://main.desk-palette/index.html", "loads": 1, "state": "live",
                "place": { "x": 0, "y": 0, "width": 1280, "height": 800, "shown": true,
                    "layer": "overlay" } },
                { "plugin": "endue.dock", "host": "main.endue-dock",
                "src": "desk-plugin://main.endue-dock/index.html",
                "place": { "x": 80, "y": 700, "width": 900, "height": 72, "shown": true } }],
            "parts": [
                { "id": "desk.agents", "x": 24, "y": 300, "width": 56, "height": 200 },
                { "id": "desk.nope", "x": 0, "y": 0, "width": 10, "height": 10 },
                { "id": "desk.rail", "x": 1200, "y": 60, "width": 0, "height": 300 }
            ]
        }))
        .unwrap();
        let layer = |i: usize| report.frames[i].place.unwrap().layer;
        assert_eq!((layer(0), layer(1)), (Layer::Overlay, Layer::Edge));
        let known: Vec<_> = report.parts.iter().filter_map(|p| p.known()).collect();
        assert_eq!(
            known,
            [desk_wm::Rect::new(24.0, 300.0, 56.0, 200.0)],
            "an unknown or empty one is no part"
        );
    }
}
