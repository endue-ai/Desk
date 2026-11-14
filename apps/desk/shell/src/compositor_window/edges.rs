//! The edges of the app the pointer is at (ADR 0221). While a window fills the whole app the desk's
//! page sends its chrome out past the app's edges, and brings a part back while the pointer is at
//! its edge. The page hears the pointer only on its own parts, so over a window it cannot tell:
//! the compositor says which edges the pointer is within `BAND` of, each time that changes
//! (`desk://compositor-edge`), and no edge once the pointer has left the app. The canvas map, which
//! the compositor draws and which goes with the right rail, counts as the right edge while the
//! pointer is on it: the page hears nothing there either. What shows is the page's to decide
//! (`packages/runtime/src/shell/away.ts`).

use desk_compositor::glam::Vec2;
use desk_compositor::input::Input;
use desk_web::sender::Role;
use serde_json::json;

use super::CompositorWindow;

/// What the page hears when the pointer comes to an edge of the app or leaves one.
pub const EDGE: &str = "desk://compositor-edge";
/// How near an edge the pointer counts as at it, in CSS pixels: the page's own band (`away.ts`).
const BAND: f32 = 10.0;

/// The edges of an app of `size` the point `at` is within `BAND` of, both in CSS pixels.
pub fn band(at: Vec2, size: Vec2) -> Vec<&'static str> {
    let mut edges = Vec::new();
    if at.x < BAND {
        edges.push("left");
    }
    if at.x >= size.x - BAND {
        edges.push("right");
    }
    if at.y < BAND {
        edges.push("top");
    }
    if at.y >= size.y - BAND {
        edges.push("bottom");
    }
    edges
}

/// The edges the pointer was last at.
#[derive(Debug, Default)]
pub struct Edges {
    at: Vec<&'static str>,
}

impl Edges {
    /// The pointer is at `edges` now: they are returned when they differ from the last ones told.
    pub fn now(&mut self, edges: Vec<&'static str>) -> Option<&[&'static str]> {
        if edges == self.at {
            return None;
        }
        self.at = edges;
        Some(&self.at)
    }
}

impl CompositorWindow {
    /// Whether the canvas map as it is drawn, open or folded to its button, is under `at`.
    fn on_map(&self, at: Vec2) -> bool {
        let (Some(layout), Some(drawn)) = (&self.mapping.layout, &self.mapping.drawn) else {
            return false;
        };
        let shown = if drawn.canvas.is_none() {
            layout.button
        } else {
            layout.outer
        };
        shown.contains(at)
    }

    /// Tell the page when a move of the pointer changes the edges it is at.
    pub(super) fn edge_input(&mut self, input: &Input) {
        let at = match input {
            Input::PointerMoved { x, y } => {
                let scale = self.window.scale_factor() as f32;
                let screen = self.hosted.wm.screen();
                let size = Vec2::new(screen.w as f32, screen.h as f32);
                let at = Vec2::new(*x, *y) / scale;
                let mut edges = band(at, size);
                if self.on_map(at) && !edges.contains(&"right") {
                    edges.insert(usize::from(edges.first() == Some(&"left")), "right");
                }
                edges
            }
            Input::PointerLeft => Vec::new(),
            _ => return,
        };
        if let Some(edges) = self.gestures.edges.now(at) {
            let edges = json!({ "edges": edges });
            self.desk.pages.emit(Role::Main, EDGE, edges);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const APP: Vec2 = Vec2::new(1280.0, 800.0);

    #[test]
    fn the_pointer_is_at_an_edge_within_ten_pixels_of_it_and_at_two_in_a_corner() {
        assert_eq!(band(Vec2::new(640.0, 400.0), APP), Vec::<&str>::new());
        assert_eq!(band(Vec2::new(9.0, 400.0), APP), ["left"]);
        assert_eq!(band(Vec2::new(10.0, 400.0), APP), Vec::<&str>::new());
        assert_eq!(band(Vec2::new(1270.0, 400.0), APP), ["right"]);
        assert_eq!(band(Vec2::new(1269.0, 400.0), APP), Vec::<&str>::new());
        assert_eq!(band(Vec2::new(640.0, 0.0), APP), ["top"]);
        assert_eq!(band(Vec2::new(640.0, 799.0), APP), ["bottom"]);
        assert_eq!(band(Vec2::new(1275.0, 3.0), APP), ["right", "top"]);
    }

    #[test]
    fn the_page_is_told_only_when_the_edges_change() {
        let mut edges = Edges::default();
        assert_eq!(edges.now(Vec::new()), None);
        assert_eq!(edges.now(vec!["left"]), Some(&["left"][..]));
        assert_eq!(edges.now(vec!["left"]), None);
        assert_eq!(edges.now(vec!["left", "top"]), Some(&["left", "top"][..]));
        // The pointer left the app: no edge.
        assert_eq!(edges.now(Vec::new()), Some(&[][..]));
        assert_eq!(edges.now(Vec::new()), None);
    }
}
