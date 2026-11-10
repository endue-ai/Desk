//! How a drag ends (ADR 0119): the release waits up to [`ANSWER_WAIT`] for the target's answer to
//! the last hover; an effect drops the items of the types the target accepts on it alone, which
//! answers `drag.done`; then the source hears `drag.ended` with the effect and the plugin that took
//! it. Escape and an OS drag leaving the window cancel; a surface that goes away takes no part any
//! more. A drop from the OS that nobody took opens its files.

use std::time::Instant;

use desk_surface::generated::{
    CompositorMessage as M, SurfaceDragDrop, SurfaceDragItem, SurfaceDropAnswer,
};
use glam::Vec2;

use super::broker::{ANSWER_WAIT, Broker, DndOut, Drag, Dropped, ended, leave, send};
use super::data::{effect_of, read_answer, taken, type_of};
use crate::input::events::Modifiers;
use crate::input::targets::Targets;
use crate::scene::Scene;

impl Broker {
    /// The pointer was released at `at`: the items go to the surface there once it answered an
    /// effect, waiting up to [`ANSWER_WAIT`] for that answer.
    #[allow(clippy::too_many_arguments)]
    pub fn release(
        &mut self,
        scene: &Scene,
        targets: &Targets,
        at: Vec2,
        mods: Modifiers,
        now: Instant,
    ) -> Vec<DndOut> {
        let Some(drag) = self.drag.as_ref() else {
            return Vec::new();
        };
        let mut out = Vec::new();
        if drag.at != at || drag.mods != mods {
            out.extend(self.hover(scene, targets, at, mods));
        }
        let Some(drag) = self.drag.take() else {
            return out;
        };
        if drag.over.is_some() && !drag.answered {
            self.settling = Some((drag, now + ANSWER_WAIT));
            return out;
        }
        out.extend(self.land(targets, drag));
        out
    }

    /// Time passed: a release whose target did not answer in time drops nothing.
    pub fn tick(&mut self, targets: &Targets, now: Instant) -> Vec<DndOut> {
        match self.settling.take() {
            Some((drag, deadline)) if now >= deadline => self.land(targets, drag),
            other => {
                self.settling = other;
                Vec::new()
            }
        }
    }

    /// Whether a release waits for an answer.
    pub fn settling(&self) -> bool {
        self.settling.is_some()
    }

    pub(super) fn land(&mut self, targets: &Targets, drag: Drag) -> Vec<DndOut> {
        let effect = effect_of(drag.effect).filter(|_| drag.answered);
        let (Some((target, local)), Some(effect)) = (drag.over.clone(), effect) else {
            let mut out: Vec<DndOut> = drag.over.iter().map(|(s, _)| leave(s)).collect();
            out.extend(Self::finish(
                &drag.source,
                &drag.paths,
                SurfaceDropAnswer::None,
                None,
                true,
            ));
            return out;
        };
        let accept = self.accepts.get(&target).cloned().unwrap_or_default();
        let offered = taken(&accept, &drag.types);
        let items: Vec<SurfaceDragItem> = drag
            .items
            .iter()
            .filter(|item| offered.contains(&type_of(item)))
            .cloned()
            .collect();
        self.drops.push(Dropped {
            target: target.clone(),
            source: drag.source.clone(),
            paths: drag.paths.clone(),
            allowed: drag.allowed.clone(),
            to: targets.owner(&target).unwrap_or(&target).to_owned(),
        });
        vec![send(M::SurfaceDragDrop(SurfaceDragDrop {
            r#type: Default::default(),
            surface: target,
            x: f64::from(local.x),
            y: f64::from(local.y),
            effect,
            items,
        }))]
    }

    /// Surface `surface` performed `effect` with the drop it received.
    pub fn done(&mut self, surface: &str, effect: SurfaceDropAnswer) -> Vec<DndOut> {
        let Some(i) = self.drops.iter().position(|d| d.target == surface) else {
            return Vec::new();
        };
        let dropped = self.drops.remove(i);
        let performed = read_answer(effect, &dropped.allowed);
        let to = (performed != SurfaceDropAnswer::None).then(|| dropped.to.clone());
        Self::finish(&dropped.source, &dropped.paths, performed, to, true)
    }

    fn finish(
        source: &Option<String>,
        paths: &[String],
        effect: SurfaceDropAnswer,
        to: Option<String>,
        dropped: bool,
    ) -> Vec<DndOut> {
        match source {
            Some(source) => vec![ended(source, effect, to)],
            None if dropped && effect == SurfaceDropAnswer::None && !paths.is_empty() => {
                vec![DndOut::Open(paths.to_vec())]
            }
            None => Vec::new(),
        }
    }

    /// Escape, or the OS drag left the window: nothing is dropped.
    pub fn cancel(&mut self) -> Vec<DndOut> {
        let Some(drag) = self.drag.take() else {
            return Vec::new();
        };
        let mut out: Vec<DndOut> = drag.over.iter().map(|(s, _)| leave(s)).collect();
        out.extend(Self::finish(
            &drag.source,
            &drag.paths,
            SurfaceDropAnswer::None,
            None,
            false,
        ));
        out
    }

    /// Surface `surface` went away (slept, destroyed, reloaded): it takes no part any more.
    pub fn gone(&mut self, targets: &Targets, surface: &str) -> Vec<DndOut> {
        self.accepts.remove(surface);
        let mut out = Vec::new();
        while self.drops.iter().any(|d| d.target == surface) {
            out.extend(self.done(surface, SurfaceDropAnswer::None));
        }
        if self.drag.as_ref().and_then(|d| d.source.as_deref()) == Some(surface) {
            if let Some(drag) = self.drag.as_mut() {
                drag.source = None;
                drag.paths.clear();
            }
            out.extend(self.cancel());
        }
        if let Some(drag) = self.drag.as_mut()
            && drag.over.as_ref().is_some_and(|(s, _)| s == surface)
        {
            drag.over = None;
            drag.effect = SurfaceDropAnswer::None;
            drag.answered = true;
        }
        if self
            .settling
            .as_ref()
            .is_some_and(|(d, _)| d.over.as_ref().is_some_and(|(s, _)| s == surface))
            && let Some((mut drag, _)) = self.settling.take()
        {
            drag.over = None;
            out.extend(self.land(targets, drag));
        }
        out
    }
}
