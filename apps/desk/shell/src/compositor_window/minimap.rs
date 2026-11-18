//! The canvas map on the compositor (#54, ADR 0082, ADR 0161, ADR 0270; the runtime's
//! `shell/Minimap.ts`, which it replaces): it shows while the desktop in front holds something to
//! find (`map_shows`), each window drawn with its icon (`desk_compositor::Icons`). A press takes the
//! view to that point and a drag moves it with the fit the press held, so the map stays still;
//! Escape puts the view back, and the wheel pans as over the background. A press on a grip along
//! its left or top edge resizes it, Escape back to where the press found it. It folds to its
//! button, and the page keeps that and the width with the session (`desk://compositor-map`, told
//! as the width changes so the strip under the map follows); it folds by itself while a filled
//! window is in sight, and the button opens it over that window until the fill goes.

use std::collections::HashMap;
use std::time::Instant;

use desk_compositor::glam::Vec2;
use desk_compositor::input::{Button, Input};
use desk_compositor::{Compositor, Icons, MapStyle, NodeId, TextureId};
use desk_surface::generated::{SurfaceCursorName, SurfaceWheelUnit};
use desk_web::sender::Role;
use desk_wm::{
    MapDrag, MapEdges, Offset, WheelMode, fill_in_sight, map_resized, map_shows, pan_centred_on,
    to_world, wheel_pan,
};
use serde_json::json;

use super::CompositorWindow;
use super::draw_map::{MapDrawn, MapLayout};

/// What the page hears when the person folds the map, opens it or resizes it: it keeps that with
/// the session.
pub const MAP: &str = "desk://compositor-map";

/// A resize from a grip: the edges it holds, where it was pressed (CSS), the canvas's width then
/// and now.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Resize {
    edges: MapEdges,
    from: Vec2,
    start: f64,
    now: f64,
}

/// The map's state between events.
#[derive(Default)]
pub struct Mapping {
    pub icons: Icons,
    /// The person opened the map over a filled window; it lasts while a fill is in sight.
    peek: bool,
    /// A press in the map: the drag it holds, where it was pressed (CSS) and the pan it started at.
    drag: Option<(MapDrag, Vec2, Offset)>,
    resize: Option<Resize>,
    /// A press on the fold button, until it is released.
    folding: bool,
    pub layout: Option<MapLayout>,
    pub drawn: Option<MapDrawn>,
}

impl Mapping {
    /// The icons `layout`'s windows show, by window, `scale` device pixels to the CSS one, in
    /// `style`'s icon colour (the focused window's in its mark's), made now where they were not;
    /// the others are let go.
    pub fn icons(
        &mut self,
        compositor: &mut Compositor,
        layout: &MapLayout,
        scale: f32,
        style: &MapStyle,
    ) -> HashMap<String, TextureId> {
        let mut shown = HashMap::new();
        for w in &layout.windows {
            let Some((path, square)) = &w.icon else {
                continue;
            };
            let px = (square.width * scale).round() as u32;
            let color = if w.focused {
                style.focused_border
            } else {
                style.icon
            };
            if let Some(id) = self.icons.icon(compositor, path, px, color) {
                shown.insert(w.id.clone(), id);
            }
        }
        self.icons.sweep(compositor);
        shown
    }

    /// The fit a drag in the map holds, while one lasts.
    pub fn held(&self) -> Option<desk_wm::Fit> {
        self.drag.as_ref().map(|(drag, ..)| drag.fit)
    }

    /// The canvas's width while a resize lasts.
    pub fn resizing(&self) -> Option<f64> {
        self.resize.map(|r| r.now)
    }

    /// The cursor over map node `node`: a grip's resize cursor, none elsewhere.
    pub fn cursor_on(&self, node: NodeId) -> Option<SurfaceCursorName> {
        let drawn = self.drawn.as_ref()?;
        let (_, edges) = drawn.grips.iter().find(|(grip, _)| *grip == node)?;
        Some(resize_cursor(*edges))
    }

    /// The cursor of the resize that lasts, wherever the pointer is.
    pub fn resize_cursor(&self) -> Option<SurfaceCursorName> {
        self.resize.map(|r| resize_cursor(r.edges))
    }
}

/// The cursor of a resize that holds `edges`.
fn resize_cursor(edges: MapEdges) -> SurfaceCursorName {
    match (edges.left, edges.top) {
        (true, true) => SurfaceCursorName::NwseResize,
        (true, false) => SurfaceCursorName::EwResize,
        _ => SurfaceCursorName::NsResize,
    }
}

impl CompositorWindow {
    /// Whether the map shows, and folded: the person folded it, or a fill is in sight and they did
    /// not open it over it. It does not show while it is away with the right rail (ADR 0221).
    pub(super) fn map_folded(&mut self) -> Option<bool> {
        let desk = self.hosted.wm.desk();
        let away = self.hosted.report().is_some_and(|r| r.map.away);
        if away || !map_shows(desk) || self.spreading.open.is_some() {
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
            Input::PointerMoved { x, y } if self.mapping.resize.is_some() => {
                self.map_resize_to(Vec2::new(*x, *y) / scale);
                true
            }
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
                let resizing = self.mapping.resize.take().is_some();
                if folding
                    && self
                        .map_node_at(device)
                        .is_some_and(|n| Some(n) == self.map_button())
                {
                    self.map_fold();
                }
                if dragging || resizing {
                    self.shared.lock().dirty = true;
                }
                folding || dragging || resizing
            }
            Input::Key(key)
                if key.key == "Escape" && key.pressed && self.mapping.resize.is_some() =>
            {
                if let Some(resize) = self.mapping.resize.take() {
                    self.map_width(resize.start);
                }
                true
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

    /// A press on the map: on its button it folds or opens on the release; on a grip a drag
    /// resizes it; on the canvas away from the part in sight it takes the view there at once;
    /// anywhere else on it a drag moves it.
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
        if let Some((_, edges)) = drawn.grips.iter().find(|(grip, _)| *grip == node) {
            let (edges, start) = (*edges, layout.width);
            self.mapping.resize = Some(Resize {
                edges,
                from: at,
                start,
                now: start,
            });
            return true;
        }
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

    /// The resize with the pointer at `at` (CSS): the width it makes, if it changed.
    fn map_resize_to(&mut self, at: Vec2) {
        let Some(resize) = self.mapping.resize else {
            return;
        };
        let d = at - resize.from;
        let size = map_resized(resize.start, resize.edges, f64::from(d.x), f64::from(d.y));
        if size.w != resize.now {
            self.map_width(size.w);
        }
    }

    /// The map `width` wide: drawn so at once, and the page told, so the strip under the map and
    /// the session follow.
    fn map_width(&mut self, width: f64) {
        if let Some(resize) = self.mapping.resize.as_mut() {
            resize.now = width;
        }
        self.desk
            .pages
            .emit(Role::Main, MAP, json!({ "width": width }));
        self.shared.lock().dirty = true;
    }

    /// The canvas of the desktop in front at `pan`: the map's, and a wheel's run's (`pan.rs`).
    pub(super) fn map_pan(&mut self, pan: Offset) {
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
                "icon": w.icon.as_ref().map(|(_, at)| quad(*at)) })
            })
            .collect();
        let grips: Vec<_> = layout.grips.iter().map(|(_, at)| quad(*at)).collect();
        json!({ "shows": drawn.is_some(), "folded": drawn.is_some_and(|d| d.canvas.is_none()),
            "width": layout.width, "outer": quad(layout.outer), "canvas": quad(layout.canvas),
            "button": quad(layout.button), "view": quad(layout.view), "windows": windows,
            "grips": grips, "peek": self.mapping.peek, "resizing": self.mapping.resize.is_some(),
            "icons": self.mapping.icons.len() })
    }
}
