//! What crosses the window's edge (#309): a surface's drag that carries files leaves for the OS,
//! and text and links from OS apps come in as desk data.
//!
//! * **Out.** A drag from a surface that offers `desk/paths` and whose pointer leaves the window is
//!   handed off: the surface it was over hears `drag.leave`, nothing is dropped, and the shell
//!   starts an OS drag of the paths with the effects the source allowed (`DndOut::HandOff`). The OS
//!   decides what its target does; the source hears `drag.ended` with that effect (`to: os`) once
//!   the OS says (`os_ended`), or `none` when it was cancelled or could not start. Other types stay
//!   in the desk. A drag without paths past the edge is over nothing, as before (ADR 0119).
//! * **In.** An OS drag of text or links (`enter_os_data`) is a drag like one of files: `desk/text`
//!   and `desk/uri` (with the `text/plain` fallback), read at the same trust boundary (a
//!   `javascript:` URI is refused whole), copied or linked, never moved.

use desk_surface::generated::{
    SurfaceDragItem, SurfaceDragText, SurfaceDragUri, SurfaceDropAnswer, SurfaceDropEffect,
};
use glam::Vec2;

use super::broker::{Broker, DndOut, ended, leave};
use super::data::{look_of, read_answer, read_items};
use crate::input::events::Modifiers;
use crate::input::targets::Targets;
use crate::scene::Scene;

/// Who took a drag the OS ended with an effect.
pub const OS: &str = "os";

impl Broker {
    /// The paths the drag under way offers, when it came from a surface.
    fn surface_paths(&self) -> Option<(String, Vec<String>)> {
        let drag = self.drag.as_ref()?;
        let source = drag.source.clone()?;
        let paths: Vec<String> = drag
            .items
            .iter()
            .find_map(|item| match item {
                SurfaceDragItem::SurfaceDragPaths(p) => {
                    Some(p.paths.iter().map(|e| e.path.clone()).collect())
                }
                _ => None,
            })
            .unwrap_or_default();
        (!paths.is_empty()).then_some((source, paths))
    }

    /// The pointer of the drag under way is at `at`, in a window of `viewport` (the scene's units):
    /// past its edge, a surface's drag of paths is handed to the OS.
    pub fn leave_window(&mut self, at: Vec2, viewport: (u32, u32)) -> Vec<DndOut> {
        let (w, h) = (viewport.0 as f32, viewport.1 as f32);
        let inside = at.x >= 0.0 && at.y >= 0.0 && at.x < w && at.y < h;
        if inside || w <= 0.0 || h <= 0.0 {
            return Vec::new();
        }
        let Some((source, paths)) = self.surface_paths() else {
            return Vec::new();
        };
        let Some(drag) = self.drag.take() else {
            return Vec::new();
        };
        let mut out: Vec<DndOut> = drag.over.iter().map(|(s, _)| leave(s)).collect();
        self.handed = Some((source, drag.allowed.clone()));
        out.push(DndOut::HandOff {
            paths,
            allowed: drag.allowed,
        });
        out
    }

    /// Whether a drag is with the OS now, waiting for `os_ended`.
    pub fn handed_off(&self) -> bool {
        self.handed.is_some()
    }

    /// The OS drag a hand-off started ended with `effect` (`None`: cancelled, or it could not
    /// start): the source hears `drag.ended`, with `to: os` when the OS did something.
    pub fn os_ended(&mut self, effect: Option<SurfaceDropAnswer>) -> Vec<DndOut> {
        let Some((source, allowed)) = self.handed.take() else {
            return Vec::new();
        };
        let performed = effect.map_or(SurfaceDropAnswer::None, |e| read_answer(e, &allowed));
        let to = (performed != SurfaceDropAnswer::None).then(|| OS.to_owned());
        vec![ended(&source, performed, to)]
    }

    /// The OS drags `text` and `uris` over the window: desk data like any drag's, once it holds.
    pub fn enter_os_data(
        &mut self,
        scene: &Scene,
        targets: &Targets,
        text: Option<&str>,
        uris: &[String],
        at: Vec2,
        mods: Modifiers,
    ) -> Vec<DndOut> {
        if self.drag.as_ref().is_some_and(|d| d.source.is_some()) {
            return Vec::new();
        }
        let mut items: Vec<SurfaceDragItem> = Vec::new();
        if let Some(text) = text.filter(|t| !t.is_empty()) {
            items.push(SurfaceDragItem::SurfaceDragText(SurfaceDragText {
                r#type: Default::default(),
                text: text.to_owned(),
            }));
        }
        if let Some(uri) = uris.first() {
            items.push(SurfaceDragItem::SurfaceDragUri(SurfaceDragUri {
                r#type: Default::default(),
                uri: uri.clone(),
                title: None,
            }));
        }
        let Some(items) = (!items.is_empty()).then(|| read_items(&items)).flatten() else {
            return Vec::new();
        };
        let mut out = self.cancel();
        let look = look_of(&items, None);
        let allowed = vec![SurfaceDropEffect::Copy, SurfaceDropEffect::Link];
        self.begin(None, OS.into(), items, allowed, look, Vec::new());
        out.extend(self.hover(scene, targets, at, mods));
        out
    }
}
