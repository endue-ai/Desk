//! The example's two focusable parts (#128): Colour, which moves the triangle's hue on, and Pause,
//! which stops and starts its turning, side by side under the triangle. Tab and Shift+Tab move
//! between them (`FocusOrder`) and hand the focus back to the desk past either end, so a keyboard
//! goes through the window as through a web plugin's; Space or Enter, a click or a screen reader's
//! click presses one. Their accessibility tree (`a11y.update`) names them, so a screen reader finds
//! them and follows the focus. Pure: the tests below run it without a GPU or a desk.

use desk_surface::generated::{SurfaceA11yActionName, SurfaceFocusEdge, SurfaceKeyDown};
use desk_surface::native::focus::{FocusOrder, Tabbed};
use serde_json::{Value, json};

/// A part, in Tab's order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Part {
    Colour,
    Pause,
}

pub const PARTS: [Part; 2] = [Part::Colour, Part::Pause];

/// A part's side, the gap between them and their margin from the bottom, in logical pixels: 44 is
/// the smallest target a pointer or a finger should have.
const SIDE: f64 = 44.0;
const GAP: f64 = 12.0;
const MARGIN: f64 = 16.0;
/// The accessibility tree's root; the parts are the nodes after it.
const ROOT: u64 = 1;

impl Part {
    pub fn name(self) -> &'static str {
        match self {
            Part::Colour => "Colour",
            Part::Pause => "Pause",
        }
    }

    fn index(self) -> usize {
        self as usize
    }

    fn node(self) -> u64 {
        ROOT + 1 + self as u64
    }

    /// Where the part is in a surface of `size` logical pixels: x, y, width, height.
    pub fn rect(self, size: (u32, u32)) -> [f64; 4] {
        let (width, height) = (f64::from(size.0), f64::from(size.1));
        let left = (width - (2.0 * SIDE + GAP)) / 2.0 + self.index() as f64 * (SIDE + GAP);
        let top = (height - MARGIN - SIDE).max(0.0);
        [left, top, SIDE, SIDE]
    }
}

/// What the plugin does after the parts heard something.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Act {
    /// Move the hue on (Colour was pressed).
    pub colour: bool,
    /// Hand the focus back past this end (`focus.leave`).
    pub leave: Option<SurfaceFocusEdge>,
    /// The focus or a part's state changed: a new accessibility update.
    pub changed: bool,
}

impl Act {
    /// Only a new accessibility update.
    pub fn changed() -> Act {
        Act {
            changed: true,
            ..Act::default()
        }
    }

    /// What a move in the focus order means: the focus moved, or it goes back past an end.
    fn moved(tabbed: Tabbed) -> Act {
        match tabbed {
            Tabbed::Not => Act::default(),
            Tabbed::To(_) => Act::changed(),
            Tabbed::Out(edge) => Act {
                leave: Some(edge),
                ..Act::changed()
            },
        }
    }
}

/// The parts' state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Controls {
    pub order: FocusOrder,
    /// The surface has the keys (`focus.in`): the focused part shows its ring.
    pub keys: bool,
    pub paused: bool,
    /// Exporting the accessibility tree (`a11y.enable`), and whether the first update went.
    a11y: Option<bool>,
}

impl Controls {
    pub fn new() -> Controls {
        Controls {
            order: FocusOrder::new(PARTS.len()),
            keys: false,
            paused: false,
            a11y: None,
        }
    }

    /// The part with the focus.
    pub fn focused(&self) -> Option<Part> {
        self.order.focused().and_then(|i| PARTS.get(i).copied())
    }

    /// The focus came in by Tab (`first`) or Shift+Tab (`last`).
    pub fn enter(&mut self, edge: SurfaceFocusEdge) -> Act {
        Act::moved(self.order.enter(edge))
    }

    /// A key went down: Tab moves the focus, Space and Enter press the focused part.
    pub fn key(&mut self, key: &SurfaceKeyDown) -> Act {
        match self.order.key(key) {
            Tabbed::Not if !key.repeat && (key.key == " " || key.key == "Enter") => self
                .focused()
                .map_or_else(Act::default, |part| self.press(part)),
            tabbed => Act::moved(tabbed),
        }
    }

    /// A press at (x, y) of a surface of `size`: on a part, it takes the focus and is pressed.
    pub fn click(&mut self, size: (u32, u32), x: f64, y: f64) -> Option<Act> {
        let part = PARTS.into_iter().find(|p| {
            let [left, top, w, h] = p.rect(size);
            x >= left && x < left + w && y >= top && y < top + h
        })?;
        self.order.focus(part.index());
        Some(Act {
            changed: true,
            ..self.press(part)
        })
    }

    /// A screen reader's action on node `node`.
    pub fn action(&mut self, node: u64, action: SurfaceA11yActionName) -> Act {
        let Some(part) = PARTS.into_iter().find(|p| p.node() == node) else {
            return Act::default();
        };
        match action {
            SurfaceA11yActionName::Click => self.press(part),
            SurfaceA11yActionName::Focus => {
                self.order.focus(part.index());
                Act::changed()
            }
            _ => Act::default(),
        }
    }

    fn press(&mut self, part: Part) -> Act {
        match part {
            Part::Colour => Act {
                colour: true,
                ..Act::default()
            },
            Part::Pause => {
                self.paused = !self.paused;
                Act::changed()
            }
        }
    }

    /// `a11y.enable`: export the tree from the next update on, or stop.
    pub fn enable(&mut self, enabled: bool) {
        self.a11y = enabled.then_some(false);
    }

    /// The accessibility update for surface `surface` of `size` logical pixels, while exporting:
    /// the tree and every node the first time, every node after (there are three).
    pub fn update(&mut self, surface: &str, size: (u32, u32)) -> Option<Value> {
        let first = !self.a11y?;
        self.a11y = Some(true);
        let bounds = |[x, y, width, height]: [f64; 4]| json!({ "x": x, "y": y, "width": width, "height": height });
        let whole = [0.0, 0.0, f64::from(size.0), f64::from(size.1)];
        let mut nodes = vec![json!({ "id": ROOT, "role": "group", "name": "Native wgpu",
            "children": PARTS.map(Part::node), "bounds": bounds(whole) })];
        for part in PARTS {
            let mut node = json!({ "id": part.node(), "role": "button", "name": part.name(),
                "actions": ["click", "focus"], "bounds": bounds(part.rect(size)) });
            if part == Part::Pause {
                node["toggled"] = json!(if self.paused { "true" } else { "false" });
            }
            nodes.push(node);
        }
        let focus = self.focused().map_or(ROOT, Part::node);
        let mut update = json!({ "type": "a11y.update", "surface": surface, "nodes": nodes,
            "focus": focus });
        if first {
            update["tree"] = json!({ "root": ROOT });
        }
        Some(update)
    }

    /// What the scene draws of the parts at `scale`: each part's box in texture pixels, the part
    /// whose ring shows (-1 for none) and whether it is paused.
    pub fn drawn(&self, size: (u32, u32), scale: f64) -> ([[f32; 4]; 2], f32, f32) {
        let rects = PARTS.map(|p| p.rect(size).map(|v| (v * scale) as f32));
        let ring = match self.focused() {
            Some(part) if self.keys => part.index() as f32,
            _ => -1.0,
        };
        (rects, ring, if self.paused { 1.0 } else { 0.0 })
    }
}

#[cfg(test)]
mod tests {
    use super::{Act, Controls, Part};
    use desk_surface::generated::{
        SurfaceA11yActionName as A, SurfaceFocusEdge as Edge, SurfaceKeyDown,
    };
    use serde_json::json;

    const SIZE: (u32, u32) = (400, 300);

    fn key(key: &str, shift: bool) -> SurfaceKeyDown {
        let modifiers: &[&str] = if shift { &["shift"] } else { &[] };
        serde_json::from_value(json!({ "type": "key.down", "surface": "s", "key": key,
            "code": "Tab", "modifiers": modifiers, "repeat": false }))
        .unwrap()
    }

    #[test]
    fn tab_goes_through_both_parts_and_hands_the_focus_back_at_either_end() {
        let mut c = Controls::new();
        assert_eq!(c.enter(Edge::First).leave, None);
        assert_eq!(c.focused(), Some(Part::Colour));
        c.key(&key("Tab", false));
        assert_eq!(c.focused(), Some(Part::Pause));
        assert_eq!(c.key(&key("Tab", false)).leave, Some(Edge::Last));
        assert_eq!(c.focused(), None);
        c.enter(Edge::Last);
        assert_eq!(c.focused(), Some(Part::Pause));
        c.key(&key("Tab", true));
        assert_eq!(c.key(&key("Tab", true)).leave, Some(Edge::First));
    }

    #[test]
    fn space_enter_clicks_and_a_screen_reader_press_the_parts() {
        let mut c = Controls::new();
        c.enter(Edge::First);
        assert!(c.key(&key(" ", false)).colour);
        c.key(&key("Tab", false));
        c.key(&key("Enter", false));
        assert!(c.paused);
        let [x, y, w, h] = Part::Colour.rect(SIZE);
        assert!(
            c.click(SIZE, x + w / 2.0, y + h / 2.0)
                .is_some_and(|a| a.colour)
        );
        assert_eq!(c.focused(), Some(Part::Colour));
        assert_eq!(
            c.click(SIZE, 10.0, 10.0),
            None,
            "the background is the plugin's own"
        );
        assert_eq!(
            c.action(4, A::Click),
            Act::default(),
            "a node it does not have"
        );
        c.action(3, A::Click);
        assert!(!c.paused);
        c.action(3, A::Focus);
        assert_eq!(c.focused(), Some(Part::Pause));
    }

    #[test]
    fn the_parts_sit_side_by_side_under_the_triangle_and_ring_only_with_the_keys() {
        let [cx, cy, cw, _] = Part::Colour.rect(SIZE);
        let [px, py, pw, _] = Part::Pause.rect(SIZE);
        assert_eq!((cy, py), (240.0, 240.0));
        assert!(px > cx + cw, "side by side");
        assert_eq!((cx + px + pw) / 2.0, 200.0, "centred");
        let mut c = Controls::new();
        c.enter(Edge::Last);
        assert_eq!(c.drawn(SIZE, 2.0).1, -1.0, "no ring without the keys");
        c.keys = true;
        let (rects, ring, paused) = c.drawn(SIZE, 2.0);
        assert_eq!((ring, paused), (1.0, 0.0));
        assert_eq!(rects[1], [(px * 2.0) as f32, 480.0, 88.0, 88.0]);
    }

    #[test]
    fn the_tree_names_both_parts_follows_the_focus_and_comes_only_when_asked() {
        let mut c = Controls::new();
        assert_eq!(c.update("s", SIZE), None);
        c.enable(true);
        let first = c.update("s", SIZE).unwrap();
        assert_eq!(first["tree"], json!({ "root": 1 }));
        assert_eq!(first["focus"], 1);
        let names: Vec<&str> = (first["nodes"].as_array().unwrap().iter())
            .filter_map(|n| n["name"].as_str())
            .collect();
        assert_eq!(names, ["Native wgpu", "Colour", "Pause"]);
        c.enter(Edge::First);
        let next = c.update("s", SIZE).unwrap();
        assert!(next.get("tree").is_none());
        assert_eq!(next["focus"], 2);
        c.enable(false);
        assert_eq!(c.update("s", SIZE), None);
    }
}
