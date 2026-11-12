//! The canvas map on the compositor (#54, ADR 0082, ADR 0161; the runtime's `shell/Minimap.ts`,
//! which it replaces): it shows while the desktop in front holds something to find (`map_shows`),
//! drawn from downscaled copies of the windows' surfaces, refreshed at most ten times a second. A
//! press takes the view to that point and a drag moves it with the fit the press held, so the map
//! stays still; Escape puts the view back, and the wheel pans as over the background. It folds to
//! its button, which the page keeps with the session (`desk://compositor-map`), and folds by itself
//! while a filled window is in sight; the button opens it over that window until the fill goes.

use std::collections::BTreeSet;
use std::time::{Duration, Instant};

use desk_compositor::glam::Vec2;
use desk_compositor::input::{Button, Input};
use desk_compositor::{NodeId, TextureId, Thumbnails};
use desk_surface::generated::SurfaceWheelUnit;
use desk_web::sender::Role;
use desk_wm::{
    MapDrag, Offset, WheelMode, fill_in_sight, map_shows, pan_centred_on, to_world, wheel_pan,
};
use serde_json::json;

use super::CompositorWindow;
use super::composed::Composed;
use super::draw_map::{MapDrawn, MapLayout};

/// What the page hears when the person folds the map or opens it: it keeps that with the session.
pub const MAP: &str = "desk://compositor-map";
/// The thumbnails are drawn again at most this often.
const REFRESH: Duration = Duration::from_millis(100);
/// A frame of pictures alone draws a surface's thumbnail again once its frames changed this share
/// of its pixels since the thumbnail was drawn: a caret's blink changes a few hundred of a window's
/// hundreds of thousands, too few to see at the map's scale, where a page of new text or a video's
/// frame changes more at once (R1). Every frame that lays the scene out draws them all.
const MAPPED_SHARE: u64 = 32;

/// Whether `changed` pixels of a `size` texture show in its thumbnail (`MAPPED_SHARE`).
fn seen(changed: u64, size: (u32, u32)) -> bool {
    changed.saturating_mul(MAPPED_SHARE) >= u64::from(size.0) * u64::from(size.1)
}

/// The map's state between events.
#[derive(Default)]
pub struct Mapping {
    pub thumbnails: Thumbnails,
    refreshed: Option<Instant>,
    /// The person opened the map over a filled window; it lasts while a fill is in sight.
    peek: bool,
    /// A press in the map: the drag it holds, where it was pressed (CSS) and the pan it started at.
    drag: Option<(MapDrag, Vec2, Offset)>,
    /// A press on the fold button, until it is released.
    folding: bool,
    pub layout: Option<MapLayout>,
    pub drawn: Option<MapDrawn>,
}

impl Mapping {
    /// Draw the thumbnails `layout` needs again (`only` those of these textures whose frames
    /// changed `MAPPED_SHARE` of their pixels since), at most every `REFRESH` (at once for one not
    /// made yet), and let go of the others; whether one is new (a scene drawn before shows none of
    /// it).
    pub fn refresh(
        &mut self,
        composed: &mut Composed,
        layout: &MapLayout,
        scale: f32,
        now: Instant,
        only: Option<&BTreeSet<TextureId>>,
    ) -> bool {
        let mut made = false;
        let due = self
            .refreshed
            .is_none_or(|at| now.duration_since(at) >= REFRESH);
        let mut keep = Vec::new();
        for (host, at) in layout.windows.iter().flat_map(|w| w.panes.iter()) {
            let Some(id) = composed.texture_of(host) else {
                continue;
            };
            let Some(source) = composed.frames.size(id) else {
                continue;
            };
            keep.push(id);
            let changed = composed.unmapped.get(&id).copied().unwrap_or_default();
            let wanted = only.is_none_or(|only| only.contains(&id) && seen(changed, source));
            if wanted && due || self.thumbnails.of(id).is_none() {
                composed.unmapped.remove(&id);
                let size = (
                    (at.width * scale).ceil() as u32,
                    (at.height * scale).ceil() as u32,
                );
                let compositor = &mut composed.compositor;
                let had = self.thumbnails.of(id);
                let thumbnail =
                    self.thumbnails
                        .refresh(compositor, id, source, (size.0.max(1), size.1.max(1)));
                made |= had != Some(thumbnail);
            }
        }
        self.thumbnails
            .retain(&mut composed.compositor, |id| keep.contains(&id));
        if due {
            self.refreshed = Some(now);
        }
        made
    }
}

impl Mapping {
    /// The fit a drag in the map holds, while one lasts.
    pub fn held(&self) -> Option<desk_wm::Fit> {
        self.drag.as_ref().map(|(drag, ..)| drag.fit)
    }
}

impl CompositorWindow {
    /// Whether the map shows, and folded: the person folded it, or a fill is in sight and they did
    /// not open it over it.
    pub(super) fn map_folded(&mut self) -> Option<bool> {
        let desk = self.hosted.wm.desk();
        if !map_shows(desk) || self.spreading.open.is_some() {
            return None;
        }
        let screen = self.hosted.wm.screen();
        let covered = fill_in_sight(desk, screen.w, screen.h);
        if !covered {
            self.mapping.peek = false;
        }
        let folded = self.hosted.report().is_some_and(|r| r.map.folded);
        Some(folded || (covered && !self.mapping.peek))
    }

    /// What the map makes of `input`; whether it took it.
    pub(super) fn map_input(&mut self, input: &Input) -> bool {
        let scale = self.window.scale_factor() as f32;
        let device = self.spreading.at;
        match input {
            Input::PointerButton {
                button: Button::Left,
                pressed: true,
            } => self.map_press(device, scale),
            Input::PointerMoved { x, y } => {
                let Some((drag, from, start)) = self.mapping.drag.clone() else {
                    return false;
                };
                let d = Vec2::new(*x, *y) / scale - from;
                let here = self.hosted.wm.desk().here();
                if let Some(pan) = drag.moved(start, f64::from(d.x), f64::from(d.y), &here) {
                    self.map_pan(pan);
                }
                true
            }
            Input::PointerButton {
                button: Button::Left,
                pressed: false,
            } => {
                let folding = std::mem::take(&mut self.mapping.folding);
                let dragging = self.mapping.drag.take().is_some();
                if folding
                    && self
                        .map_node_at(device)
                        .is_some_and(|n| Some(n) == self.map_button())
                {
                    self.map_fold();
                }
                if dragging {
                    self.shared.lock().dirty = true;
                }
                folding || dragging
            }
            Input::Key(key) if key.key == "Escape" && key.pressed => {
                let Some((drag, ..)) = self.mapping.drag.take() else {
                    return false;
                };
                let here = self.hosted.wm.desk().here();
                if let Some(pan) = drag.cancelled(&here) {
                    self.map_pan(pan);
                }
                true
            }
            Input::Wheel { dx, dy, unit } if self.map_node_at(device).is_some() => {
                let mode = match unit {
                    SurfaceWheelUnit::Pixel => WheelMode::Pixel,
                    SurfaceWheelUnit::Line => WheelMode::Line,
                    SurfaceWheelUnit::Page => WheelMode::Page,
                };
                let (dx, dy) = match mode {
                    WheelMode::Pixel => (dx / f64::from(scale), dy / f64::from(scale)),
                    _ => (*dx, *dy),
                };
                let desk = self.hosted.wm.desk();
                let pan = desk.pan_of(&desk.here());
                let page = self.hosted.wm.screen().h;
                self.map_pan(wheel_pan(pan, dx, dy, mode, page));
                true
            }
            _ => false,
        }
    }

    /// A press on the map: on its button it folds or opens on the release; on the canvas away
    /// from the part in sight it takes the view there at once; anywhere on it a drag moves it.
    fn map_press(&mut self, device: Vec2, scale: f32) -> bool {
        let Some(node) = self.map_node_at(device) else {
            return false;
        };
        if Some(node) == self.map_button() {
            self.mapping.folding = true;
            return true;
        }
        let (Some(layout), Some(drawn)) = (self.mapping.layout.clone(), &self.mapping.drawn) else {
            return true;
        };
        let at = device / scale;
        let desk = self.hosted.wm.desk();
        let here = desk.here();
        let before = desk.pan_of(&here);
        let mut start = before;
        if drawn.view != Some(node) {
            let local = at - Vec2::new(layout.canvas.x, layout.canvas.y);
            let world = to_world(f64::from(local.x), f64::from(local.y), layout.fit);
            let screen = self.hosted.wm.screen();
            start = pan_centred_on(world, screen.w, screen.h);
            self.map_pan(start);
        }
        let drag = MapDrag {
            before,
            fit: layout.fit,
            desktop: here,
        };
        self.mapping.drag = Some((drag, at, start));
        true
    }

    /// The fold button pressed: fold the open map, or open the folded one; over a filled window
    /// that only ends or starts a peek.
    fn map_fold(&mut self) {
        let screen = self.hosted.wm.screen();
        let covered = fill_in_sight(self.hosted.wm.desk(), screen.w, screen.h);
        let kept = self.hosted.report().is_some_and(|r| r.map.folded);
        let open = !kept && (self.mapping.peek || !covered);
        let folded = if open {
            if covered {
                self.mapping.peek = false;
                kept
            } else {
                true
            }
        } else {
            self.mapping.peek = covered;
            false
        };
        if folded != kept {
            self.desk
                .pages
                .emit(Role::Main, MAP, json!({ "folded": folded }));
        }
        self.shared.lock().dirty = true;
    }

    fn map_pan(&mut self, pan: Offset) {
        let outs = self.hosted.wm.pan_to(pan);
        if !outs.is_empty() && self.emit_wm(outs) {
            let outcome = self.hosted.replan(Instant::now());
            self.carry(outcome);
        }
    }

    fn map_button(&self) -> Option<NodeId> {
        self.mapping.drawn.as_ref().map(|d| d.button)
    }

    /// The map's node topmost at device point `at`, if the map is there.
    fn map_node_at(&self, at: Vec2) -> Option<NodeId> {
        let drawn = self.mapping.drawn.as_ref()?;
        let hit = desk_compositor::hit_test(&self.scene, at)?;
        drawn.nodes.contains(&hit.node).then_some(hit.node)
    }

    /// The map's state, for checks (development builds).
    pub fn map_state(&self) -> serde_json::Value {
        let Some(layout) = &self.mapping.layout else {
            return json!({ "shows": false });
        };
        let drawn = self.mapping.drawn.as_ref();
        let quad = |r: desk_compositor::Rect| [r.x, r.y, r.width, r.height];
        let windows: Vec<_> = (layout.windows.iter())
            .map(|w| {
                json!({ "id": w.id, "rect": quad(w.rect), "focused": w.focused,
                "thumbnails": w.panes.len() })
            })
            .collect();
        json!({ "shows": drawn.is_some(), "folded": drawn.is_some_and(|d| d.canvas.is_none()),
            "outer": quad(layout.outer), "canvas": quad(layout.canvas), "button": quad(layout.button),
            "view": quad(layout.view), "windows": windows, "peek": self.mapping.peek,
            "thumbnails": self.mapping.thumbnails.len() })
    }
}

#[cfg(test)]
mod tests {
    use super::seen;

    #[test]
    fn a_carets_blink_does_not_show_in_a_thumbnail_and_a_page_of_new_text_does() {
        let window = (656, 422);
        assert!(!seen(17 * 34, window), "a blink");
        assert!(!seen(17 * 34 * 14, window), "fourteen blinks");
        assert!(seen(17 * 34 * 15, window), "fifteen add up to a 32nd");
        assert!(seen(656 * 60, window), "a few lines of output");
        assert!(seen(u64::MAX, window), "no overflow");
    }
}
