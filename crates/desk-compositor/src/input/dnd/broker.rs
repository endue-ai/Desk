//! The drag broker (ADR 0119, `packages/runtime/src/dnd/broker.ts`), run by the compositor: one drag
//! at a time, from a surface or from the OS. The surface under the pointer hears `drag.enter`,
//! `drag.over` and `drag.leave` with the offered types it accepts, never the items, and only if it
//! accepts one; it answers the effect it would perform. On release the compositor waits up to 400 ms
//! for the answer to the last hover and drops only on an effect: the items of the types it accepts
//! go to that surface alone, and the source hears how it ended. An OS drop nobody takes opens.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use desk_surface::generated::{
    CompositorMessage as M, SurfaceDragEnded, SurfaceDragEnter, SurfaceDragItem, SurfaceDragLeave,
    SurfaceDragOver, SurfaceDragStart, SurfaceDropAnswer, SurfaceDropEffect,
};
use glam::Vec2;

use super::data::{
    DragLook, look_of, paths_item, read_answer, read_effects, read_items, taken, type_of,
    with_fallback,
};
use crate::input::events::Modifiers;
use crate::input::targets::Targets;
use crate::scene::Scene;

/// How long a release waits for the target's answer to the last hover.
pub const ANSWER_WAIT: Duration = Duration::from_millis(400);

/// What the broker asks of the compositor.
#[derive(Clone, Debug, PartialEq)]
pub enum DndOut {
    Send(M),
    /// A drop from the OS that no surface took: the desk opens the files, as before.
    Open(Vec<String>),
}

/// The drag image the compositor draws above every window: for a drag from a surface, the image
/// under the pointer; for files from the OS, which draws their image, where they go (#162).
#[derive(Clone, Debug, PartialEq)]
pub struct DragOverlay {
    pub look: DragLook,
    pub at: Vec2,
    pub effect: SurfaceDropAnswer,
    /// Files from the OS that no surface takes here: dropped, they open on the desk.
    pub opens: bool,
}

#[derive(Clone, Debug)]
pub(super) struct Drag {
    /// The surface it started in; none for the OS.
    pub(super) source: Option<String>,
    /// The plugin it started in, or `os`.
    pub(super) from: String,
    pub(super) items: Vec<SurfaceDragItem>,
    pub(super) types: Vec<String>,
    pub(super) allowed: Vec<SurfaceDropEffect>,
    pub(super) look: DragLook,
    pub(super) at: Vec2,
    pub(super) mods: Modifiers,
    pub(super) over: Option<(String, Vec2)>,
    pub(super) effect: SurfaceDropAnswer,
    pub(super) answered: bool,
    pub(super) paths: Vec<String>,
}

#[derive(Clone, Debug)]
pub(super) struct Dropped {
    pub(super) target: String,
    pub(super) source: Option<String>,
    pub(super) paths: Vec<String>,
    pub(super) allowed: Vec<SurfaceDropEffect>,
    pub(super) to: String,
}

/// The broker's state: what each surface accepts, the drag under way, a release waiting for its
/// answer, and drops waiting for `drag.done`.
#[derive(Clone, Debug, Default)]
pub struct Broker {
    pub(super) accepts: HashMap<String, Vec<String>>,
    pub(super) drag: Option<Drag>,
    pub(super) settling: Option<(Drag, Instant)>,
    pub(super) drops: Vec<Dropped>,
}

pub(super) fn send(m: M) -> DndOut {
    DndOut::Send(m)
}

pub(super) fn leave(surface: &str) -> DndOut {
    send(M::SurfaceDragLeave(SurfaceDragLeave {
        r#type: Default::default(),
        surface: surface.to_owned(),
    }))
}

pub(super) fn ended(surface: &str, effect: SurfaceDropAnswer, to: Option<String>) -> DndOut {
    send(M::SurfaceDragEnded(SurfaceDragEnded {
        r#type: Default::default(),
        surface: surface.to_owned(),
        effect,
        to,
    }))
}

impl Broker {
    /// The types surface `surface`'s targets take.
    pub fn accept(&mut self, surface: &str, types: &[String]) {
        let kept: Vec<String> = types
            .iter()
            .filter(|t| t.len() <= 160)
            .take(32)
            .cloned()
            .collect();
        self.accepts.insert(surface.to_owned(), kept);
    }

    /// Whether a drag is under way (the compositor owns the pointer).
    pub fn active(&self) -> bool {
        self.drag.is_some()
    }

    /// Whether the drag under way came from the OS (it draws its own image and cursor).
    pub fn from_os(&self) -> bool {
        self.drag.as_ref().is_some_and(|d| d.source.is_none())
    }

    /// The effect the target under the pointer answered, during a drag.
    pub fn effect(&self) -> Option<SurfaceDropAnswer> {
        self.drag.as_ref().map(|d| d.effect)
    }

    /// The surface the drag is over, if one takes it.
    pub fn over(&self) -> Option<&str> {
        self.drag.as_ref()?.over.as_ref().map(|(s, _)| s.as_str())
    }

    /// What the compositor draws for a drag: a surface's drag image, or where the OS's files go,
    /// once the pointer is in the window. A drop from the OS that no surface takes with an effect
    /// opens its files (`land`).
    pub fn overlay(&self) -> Option<DragOverlay> {
        let drag = self.drag.as_ref().filter(|d| d.at.is_finite())?;
        let taken = drag.over.is_some() && drag.effect != SurfaceDropAnswer::None;
        Some(DragOverlay {
            look: drag.look.clone(),
            at: drag.at,
            effect: drag.effect,
            opens: drag.source.is_none() && !taken,
        })
    }

    /// Surface `surface` asks to drag; `held` is the surface a press is held on now. A drag that
    /// does not hold, or that no press stands behind, ends at once with `none`.
    #[allow(clippy::too_many_arguments)]
    pub fn start(
        &mut self,
        scene: &Scene,
        targets: &Targets,
        start: &SurfaceDragStart,
        held: Option<&str>,
        at: Vec2,
        mods: Modifiers,
    ) -> Vec<DndOut> {
        let surface = start.surface.as_str();
        let items = read_items(&start.items);
        let allowed = read_effects(&start.effect_allowed);
        let pressed = held == Some(surface);
        let (Some(items), Some(allowed), true, false) = (items, allowed, pressed, self.active())
        else {
            return vec![ended(surface, SurfaceDropAnswer::None, None)];
        };
        let from = targets.owner(surface).unwrap_or(surface).to_owned();
        let look = look_of(&items, start.image.as_ref());
        self.begin(
            Some(surface.to_owned()),
            from,
            items,
            allowed,
            look,
            Vec::new(),
        );
        self.hover(scene, targets, at, mods)
    }

    /// The OS drags `paths` over the window: from here on it is a drag like any other. The OS keeps
    /// its files, so a drop copies or links them, never moves them out of their folder.
    pub fn enter_os(
        &mut self,
        scene: &Scene,
        targets: &Targets,
        paths: Vec<String>,
        at: Vec2,
        mods: Modifiers,
    ) -> Vec<DndOut> {
        let paths: Vec<String> = paths
            .into_iter()
            .filter(|p| super::data::path_holds(p))
            .collect();
        if paths.is_empty() || self.drag.as_ref().is_some_and(|d| d.source.is_some()) {
            return Vec::new();
        }
        let mut out = self.cancel();
        let items = with_fallback(vec![paths_item(&paths)]);
        let look = look_of(&items, None);
        let allowed = vec![SurfaceDropEffect::Copy, SurfaceDropEffect::Link];
        self.begin(None, "os".into(), items, allowed, look, paths);
        out.extend(self.hover(scene, targets, at, mods));
        out
    }

    fn begin(
        &mut self,
        source: Option<String>,
        from: String,
        items: Vec<SurfaceDragItem>,
        allowed: Vec<SurfaceDropEffect>,
        look: DragLook,
        paths: Vec<String>,
    ) {
        self.drag = Some(Drag {
            source,
            from,
            types: items.iter().map(type_of).collect(),
            items,
            allowed,
            look,
            at: Vec2::new(f32::NAN, f32::NAN),
            mods: Modifiers::default(),
            over: None,
            effect: SurfaceDropAnswer::None,
            answered: true,
            paths,
        });
    }

    /// The pointer moved, or the keys changed: the surface under it takes the drag if it accepts
    /// one of its types, the one before leaves.
    pub fn hover(
        &mut self,
        scene: &Scene,
        targets: &Targets,
        at: Vec2,
        mods: Modifiers,
    ) -> Vec<DndOut> {
        let Some(drag) = self.drag.as_mut() else {
            return Vec::new();
        };
        drag.at = at;
        drag.mods = mods;
        let under = targets.surface_at(scene, at);
        let types = under
            .as_ref()
            .map(|(s, _)| {
                taken(
                    self.accepts.get(s).map_or(&[][..], Vec::as_slice),
                    &drag.types,
                )
            })
            .unwrap_or_default();
        let target = under.filter(|_| !types.is_empty());
        let mut out = Vec::new();
        let same = drag.over.as_ref().map(|(s, _)| s) == target.as_ref().map(|(s, _)| s);
        if !same {
            if let Some((old, _)) = drag.over.take() {
                out.push(leave(&old));
            }
            drag.effect = SurfaceDropAnswer::None;
            drag.answered = true;
        }
        let Some((surface, local)) = target else {
            return out;
        };
        drag.answered = false;
        let (x, y) = (f64::from(local.x), f64::from(local.y));
        let message = if same {
            M::SurfaceDragOver(SurfaceDragOver {
                r#type: Default::default(),
                surface: surface.clone(),
                x,
                y,
                modifiers: mods.list(),
            })
        } else {
            M::SurfaceDragEnter(SurfaceDragEnter {
                r#type: Default::default(),
                surface: surface.clone(),
                x,
                y,
                types,
                effect_allowed: drag.allowed.clone(),
                modifiers: mods.list(),
                from: drag.from.clone(),
            })
        };
        drag.over = Some((surface, local));
        out.push(send(message));
        out
    }

    /// Surface `surface` answered the last hover.
    pub fn status(
        &mut self,
        targets: &Targets,
        surface: &str,
        effect: SurfaceDropAnswer,
    ) -> Vec<DndOut> {
        if let Some(drag) = self.drag.as_mut()
            && drag.over.as_ref().is_some_and(|(s, _)| s == surface)
        {
            drag.effect = read_answer(effect, &drag.allowed);
            drag.answered = true;
            return Vec::new();
        }
        match self.settling.take() {
            Some((mut drag, _)) if drag.over.as_ref().is_some_and(|(s, _)| s == surface) => {
                drag.effect = read_answer(effect, &drag.allowed);
                drag.answered = true;
                self.land(targets, drag)
            }
            other => {
                self.settling = other;
                Vec::new()
            }
        }
    }
}
