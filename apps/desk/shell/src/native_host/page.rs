//! What the runtime posts to a native plugin's surface, as messages of the plugin's surface
//! connection (`specs/surface/v0/native.md`), and Tab's way back out. A page message goes as
//! `desk.message`. The runtime's own `desk:surface-enter` (the runtime page's Tab reached the
//! surface's place, #123) is no page message: it goes as `focus.enter` with its edge (#128), as the
//! web host's shim focuses a page's first or last control. The plugin's `focus.leave` past an end is
//! what a web page's `OnTakeFocus` is (`connection.rs`): the relay has the runtime's page move its
//! focus on from the place, forward past its last edge or backward before its first (ADR 0160).

use desk_surface::generated::{CompositorMessage, SurfaceFocusEdge, SurfaceFocusLeave};
use serde_json::{Value, json};

/// What the runtime's page posts when its Tab enters a surface's place (`pages/place.ts`).
const ENTER: &str = "desk:surface-enter";

/// The message for surface `surface`'s process that the runtime's `text` means; `None` for one that
/// means nothing on the connection.
pub fn down(surface: &str, text: &str) -> Option<CompositorMessage> {
    let message: Value = serde_json::from_str(text).ok()?;
    let value = if message.get("type").and_then(Value::as_str) == Some(ENTER) {
        json!({ "type": "focus.enter", "surface": surface, "edge": message.get("edge")? })
    } else {
        json!({ "type": "desk.message", "surface": surface, "message": message })
    };
    serde_json::from_value(value).ok()
}

/// Whether the focus a plugin hands back goes on forward (past its last element), as the relay's
/// `leave` takes it.
pub fn forward(leave: &SurfaceFocusLeave) -> bool {
    leave.edge == SurfaceFocusEdge::Last
}

#[cfg(test)]
mod tests {
    use super::{down, forward};
    use desk_surface::generated::{CompositorMessage, SurfaceFocusEdge};
    use serde_json::json;

    const SURFACE: &str = "main.example-native--wgpu";

    #[test]
    fn the_runtimes_tab_into_a_place_reaches_the_plugin_as_focus_enter_at_its_edge() {
        for (edge, want) in [
            ("first", SurfaceFocusEdge::First),
            ("last", SurfaceFocusEdge::Last),
        ] {
            let text = json!({ "type": "desk:surface-enter", "edge": edge }).to_string();
            let Some(CompositorMessage::SurfaceFocusEnter(enter)) = down(SURFACE, &text) else {
                panic!("{text}")
            };
            assert_eq!((enter.surface.as_str(), enter.edge), (SURFACE, want));
        }
        let middle = json!({ "type": "desk:surface-enter", "edge": "middle" }).to_string();
        assert_eq!(down(SURFACE, &middle), None, "a place has two edges");
        let none = json!({ "type": "desk:surface-enter" }).to_string();
        assert_eq!(down(SURFACE, &none), None);
    }

    #[test]
    fn page_messages_go_as_desk_message_and_texts_that_are_none_go_nowhere() {
        let text = json!({ "type": "desk:ping", "n": 4 }).to_string();
        let Some(CompositorMessage::SurfaceDesk(desk)) = down(SURFACE, &text) else {
            panic!("{text}")
        };
        assert_eq!(desk.message.get("n"), Some(&json!(4)));
        assert_eq!(down(SURFACE, "not json"), None);
        assert_eq!(down(SURFACE, "[1, 2]"), None);
    }

    #[test]
    fn a_focus_handed_back_past_the_last_element_goes_on_forward() {
        let leave = |edge: &str| {
            serde_json::from_value(
                json!({ "type": "focus.leave", "surface": SURFACE, "edge": edge }),
            )
            .unwrap()
        };
        assert!(forward(&leave("last")));
        assert!(!forward(&leave("first")));
    }
}
