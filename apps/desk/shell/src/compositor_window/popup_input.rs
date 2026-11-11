//! A press on a popup widget is the popup's alone (#156, B6b). A plugin window's popup is drawn
//! above every window and may lie past its own, over another window or the desk (`draw_popup.rs`).
//! The window manager and the desk's page hear every press first, where it lands on the desk (ADR
//! 0150, ADR 0153): a press on the popup's part over another window would be that window's, which
//! the page focuses and raises, and the popup's page, losing the focus, closes it before the click
//! lands; on that window's edge it would start a resize. So a press that lands on a popup, and the
//! moves and the release that follow it until the last button goes up, go to the popup's surface
//! only, past the window manager, and the page hears none of them; nor does it hear the pointer
//! move over a popup while no press holds it (no hover card of a tool under the popup, no grip's
//! cursor). A part of the desk's system layer drawn over the popup (a bar, a scrim) is the page's,
//! as anywhere.

use desk_compositor::Rect;
use desk_compositor::glam::Vec2;
use desk_compositor::input::{Area, Input, Out};
use desk_surface::generated::CompositorMessage as M;
use desk_wm::HostWindow;

use super::super::{CompositorWindow, PAGE};
use crate::web_host::lifecycle::surface_of;

/// The popups drawn, and the buttons a press on one holds.
#[derive(Debug, Default)]
pub struct PopupPress {
    /// The popups as last drawn: each one's surface and box, in CSS pixels.
    pub boxes: Vec<(String, desk_wm::Rect)>,
    held: usize,
}

impl PopupPress {
    /// Whether `input` is a popup's: a press on one (`on`), what follows it, or a move onto one
    /// while no press holds the pointer (`free`).
    fn hears(&mut self, input: &Input, free: bool, on: impl Fn() -> bool) -> bool {
        match input {
            Input::PointerButton { pressed: true, .. } if self.held > 0 || on() => {
                self.held += 1;
                true
            }
            Input::PointerButton { pressed: false, .. } if self.held > 0 => {
                self.held -= 1;
                true
            }
            Input::PointerMoved { .. } => self.held > 0 || (free && on()),
            _ => false,
        }
    }
}

/// Whether `out` is a pointer message for the desk's page.
fn to_page(out: &Out) -> bool {
    let Out::Send(message) = out else {
        return false;
    };
    let pointer = matches!(
        message,
        M::SurfacePointerDown(_) | M::SurfacePointerUp(_) | M::SurfacePointerMove(_)
    );
    pointer && surface_of(message).as_deref() == Some(PAGE)
}

/// The windows back to front, each covering what lies under it for the router (issue 159, finding
/// 5), in device pixels at `scale`, each with the surfaces `made` shows in it; then each window's
/// popup in `popups`, above them all, covering what it lies over for its own surface: a press on a
/// popup's part over another window is the popup's, not the page's there.
pub fn areas(
    windows: &[HostWindow],
    made: &[(String, String, bool)],
    popups: &[(String, desk_wm::Rect)],
    scale: f32,
) -> Vec<Area> {
    let device = |r: desk_wm::Rect| {
        let s = scale;
        Rect::new(
            r.x as f32 * s,
            r.y as f32 * s,
            r.w as f32 * s,
            r.h as f32 * s,
        )
    };
    let mut areas: Vec<Area> = (windows.iter())
        .map(|w| Area {
            rect: device(w.rect),
            surfaces: (w.panes.iter().filter_map(|p| p.plugin.as_deref()))
                .flat_map(|plugin| made.iter().filter(move |(_, of, _)| of == plugin))
                .map(|(host, _, _)| host.clone())
                .collect(),
        })
        .collect();
    let above: Vec<Area> = (popups.iter())
        .filter(|(host, _)| areas.iter().any(|a| a.surfaces.contains(host)))
        .map(|(host, at)| Area {
            rect: device(*at),
            surfaces: vec![host.clone()],
        })
        .collect();
    areas.extend(above);
    areas
}

impl CompositorWindow {
    /// Whether `input` belongs to a press on a popup or moves over one, which neither the window
    /// manager nor the page hears.
    pub(super) fn popup_input(&mut self, input: &Input) -> bool {
        let scale = self.window.scale_factor() as f32;
        let (capture, _, at) = self.router.pointer_state();
        let free = capture.is_none();
        let device = match input {
            Input::PointerMoved { x, y } => Vec2::new(*x, *y),
            _ => at,
        };
        let (x, y) = (f64::from(device.x / scale), f64::from(device.y / scale));
        let (scene, targets) = (&self.scene, &self.router.targets);
        let boxes = self.gestures.popups.boxes.clone();
        let on = || {
            let inside =
                |r: &desk_wm::Rect| x >= r.x && x < r.right() && y >= r.y && y < r.bottom();
            boxes.iter().any(|(_, at)| inside(at))
                && targets
                    .surface_at(scene, device)
                    .is_some_and(|(s, _)| s != PAGE)
        };
        self.gestures.popups.hears(input, free, on)
    }

    /// What the router says for a popup's input, without the page's pointer messages.
    pub(super) fn popup_outs(outs: Vec<Out>) -> Vec<Out> {
        outs.into_iter().filter(|o| !to_page(o)).collect()
    }
}

#[cfg(test)]
mod tests {
    use desk_compositor::input::{Button, Input, Out};
    use desk_surface::generated::CompositorMessage;
    use serde_json::json;

    use super::{PopupPress, to_page};

    fn button(pressed: bool) -> Input {
        Input::PointerButton {
            button: Button::Left,
            pressed,
        }
    }

    #[test]
    fn a_press_on_a_popup_holds_until_its_last_button_goes_up() {
        let mut press = PopupPress::default();
        let moved = Input::PointerMoved { x: 1.0, y: 2.0 };
        assert!(!press.hears(&moved, true, || false), "elsewhere");
        assert!(
            press.hears(&moved, true, || true),
            "over a popup, nothing held"
        );
        assert!(
            !press.hears(&moved, false, || true),
            "a window's drag over one"
        );
        assert!(
            !press.hears(&button(true), true, || false),
            "a press elsewhere"
        );
        assert!(!press.hears(&button(false), false, || false));
        assert!(
            press.hears(&button(true), true, || true),
            "a press on a popup"
        );
        assert!(press.hears(&moved, false, || false), "its drag");
        assert!(
            press.hears(&button(true), false, || false),
            "a second button"
        );
        assert!(press.hears(&button(false), false, || false));
        assert!(press.hears(&button(false), false, || false), "its release");
        assert!(!press.hears(&moved, true, || false), "over");
        assert!(!press.hears(&Input::PointerLeft, true, || true));
    }

    #[test]
    fn only_the_pages_pointer_messages_are_left_out() {
        let message = |surface: &str, kind: &str| {
            let mut m = json!({ "type": kind, "surface": surface, "x": 1.0, "y": 2.0,
                "buttons": [], "modifiers": [] });
            if kind != "pointer.move" {
                m["button"] = json!("left");
                m["clicks"] = json!(1);
            }
            Out::Send(serde_json::from_value::<CompositorMessage>(m).unwrap())
        };
        assert!(to_page(&message("desk", "pointer.down")));
        assert!(to_page(&message("desk", "pointer.move")));
        assert!(!to_page(&message("main.e2e-popup", "pointer.down")));
        assert!(!to_page(&Out::Redraw));
    }
}
