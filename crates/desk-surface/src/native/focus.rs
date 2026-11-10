//! A native plugin's own focus order (`input.md`, Tab through a surface, #128): its focusable parts
//! in order, the one with the focus, and what `focus.enter`, Tab and Shift+Tab do to it. Tab moves
//! on and Shift+Tab back; past the last part, or before the first, the focus leaves the plugin and
//! it hands the focus back with `focus.leave` (`Plugin::leave_focus`), as a page's last control
//! hands it on past its frame. Nothing wraps. Pure: no connection, no clock.

use crate::generated::{SurfaceFocusEdge, SurfaceKeyDown, SurfaceModifier};

/// What a message did to the focus order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tabbed {
    /// Not Tab or Shift+Tab: a key of the plugin's own.
    Not,
    /// The focus is on this part now.
    To(usize),
    /// The focus went past this end of the order: hand it back to the desk (`focus.leave`).
    Out(SurfaceFocusEdge),
}

/// The plugin's focusable parts, `0..parts` in Tab's order, and the one with the focus.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FocusOrder {
    parts: usize,
    focused: Option<usize>,
}

impl FocusOrder {
    /// An order of `parts` parts, none of them focused.
    pub fn new(parts: usize) -> FocusOrder {
        FocusOrder {
            parts,
            focused: None,
        }
    }

    /// The part with the focus, if one has it.
    pub fn focused(&self) -> Option<usize> {
        self.focused
    }

    /// The focus is on `part` (a click, a screen reader's focus); one past the end is ignored.
    pub fn focus(&mut self, part: usize) {
        if part < self.parts {
            self.focused = Some(part);
        }
    }

    /// `focus.enter`: the part at that end has the focus, or with no parts at all the focus passes
    /// on out of the other end, as Tab passes by a frame with nothing to focus.
    pub fn enter(&mut self, edge: SurfaceFocusEdge) -> Tabbed {
        if self.parts == 0 {
            self.focused = None;
            return Tabbed::Out(other(edge));
        }
        let part = match edge {
            SurfaceFocusEdge::First => 0,
            SurfaceFocusEdge::Last => self.parts - 1,
        };
        self.focused = Some(part);
        Tabbed::To(part)
    }

    /// A key went down while the surface has the keys: Tab and Shift+Tab move the focus, any other
    /// key (Control+Tab is the desk's and never comes) is the plugin's.
    pub fn key(&mut self, key: &SurfaceKeyDown) -> Tabbed {
        let held = |m: SurfaceModifier| key.modifiers.contains(&m);
        let chord = [
            SurfaceModifier::Ctrl,
            SurfaceModifier::Alt,
            SurfaceModifier::Meta,
        ];
        if key.key != "Tab" || chord.into_iter().any(held) {
            return Tabbed::Not;
        }
        self.tab(held(SurfaceModifier::Shift))
    }

    /// Tab, or Shift+Tab with `back`: the next part (the first when none had the focus), or out
    /// past the end, where the focus leaves and no part keeps it.
    pub fn tab(&mut self, back: bool) -> Tabbed {
        let next = match (self.focused, back) {
            (None, false) => Some(0),
            (None, true) => self.parts.checked_sub(1),
            (Some(part), false) => Some(part + 1),
            (Some(part), true) => part.checked_sub(1),
        };
        match next.filter(|part| *part < self.parts) {
            Some(part) => {
                self.focused = Some(part);
                Tabbed::To(part)
            }
            None => {
                self.focused = None;
                Tabbed::Out(if back {
                    SurfaceFocusEdge::First
                } else {
                    SurfaceFocusEdge::Last
                })
            }
        }
    }
}

fn other(edge: SurfaceFocusEdge) -> SurfaceFocusEdge {
    match edge {
        SurfaceFocusEdge::First => SurfaceFocusEdge::Last,
        SurfaceFocusEdge::Last => SurfaceFocusEdge::First,
    }
}

#[cfg(test)]
mod tests {
    use super::{FocusOrder, Tabbed};
    use crate::generated::{SurfaceFocusEdge as Edge, SurfaceKeyDown};
    use serde_json::json;

    fn key(key: &str, modifiers: &[&str]) -> SurfaceKeyDown {
        serde_json::from_value(json!({ "type": "key.down", "surface": "s", "key": key,
            "code": if key == "Tab" { "Tab" } else { "KeyA" }, "modifiers": modifiers,
            "repeat": false }))
        .unwrap()
    }

    #[test]
    fn tab_enters_at_the_first_part_moves_on_and_leaves_past_the_last() {
        let mut order = FocusOrder::new(2);
        assert_eq!(order.enter(Edge::First), Tabbed::To(0));
        assert_eq!(order.key(&key("Tab", &[])), Tabbed::To(1));
        assert_eq!(order.key(&key("Tab", &[])), Tabbed::Out(Edge::Last));
        assert_eq!(
            order.focused(),
            None,
            "nothing keeps the focus it handed back"
        );
    }

    #[test]
    fn shift_tab_enters_at_the_last_part_moves_back_and_leaves_before_the_first() {
        let mut order = FocusOrder::new(2);
        assert_eq!(order.enter(Edge::Last), Tabbed::To(1));
        assert_eq!(order.key(&key("Tab", &["shift"])), Tabbed::To(0));
        assert_eq!(order.key(&key("Tab", &["shift"])), Tabbed::Out(Edge::First));
    }

    #[test]
    fn a_plugin_with_nothing_to_focus_passes_the_focus_on_out_of_its_other_end() {
        let mut order = FocusOrder::new(0);
        assert_eq!(order.enter(Edge::First), Tabbed::Out(Edge::Last));
        assert_eq!(order.enter(Edge::Last), Tabbed::Out(Edge::First));
        assert_eq!(order.tab(false), Tabbed::Out(Edge::Last));
    }

    #[test]
    fn tab_with_no_part_focused_starts_at_an_end_and_a_click_moves_the_focus() {
        let mut order = FocusOrder::new(3);
        assert_eq!(order.tab(false), Tabbed::To(0));
        let mut order = FocusOrder::new(3);
        assert_eq!(order.tab(true), Tabbed::To(2));
        order.focus(1);
        assert_eq!(order.focused(), Some(1));
        order.focus(3);
        assert_eq!(order.focused(), Some(1), "a part it does not have");
        assert_eq!(order.tab(false), Tabbed::To(2));
    }

    #[test]
    fn other_keys_and_chords_with_tab_are_the_plugins_own() {
        let mut order = FocusOrder::new(2);
        order.focus(0);
        assert_eq!(order.key(&key("a", &[])), Tabbed::Not);
        for chord in ["ctrl", "alt", "meta"] {
            assert_eq!(order.key(&key("Tab", &[chord])), Tabbed::Not);
            assert_eq!(order.key(&key("Tab", &["shift", chord])), Tabbed::Not);
        }
        assert_eq!(order.focused(), Some(0));
        assert_eq!(order.key(&key("Tab", &["caps-lock"])), Tabbed::To(1));
    }
}
