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
    /// The document its frame shows (the stand-in's URL, the plugin's own).
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
    use super::DeskReport;
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
}
