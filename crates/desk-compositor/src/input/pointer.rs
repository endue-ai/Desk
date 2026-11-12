//! The pointer (`input.md` § Pointer): every event goes to the surface topmost under it, in that
//! surface's logical pixels, through the scene's transforms. A press captures the pointer: until its
//! last button goes up, moves and the release go to the surface that took the press, wherever the
//! pointer is. A surface the pointer leaves hears `pointer.leave`. Quick presses in one place count
//! as clicks (2 is a double click). An underlay (the shell page that still draws the windows' frames
//! around the plugin surfaces, until #53) hears moves and presses over the surfaces above it too, at
//! its own coordinates, so its window manager sees a press on a window it holds; never wheels.

use std::time::{Duration, Instant};

use desk_surface::generated::{CompositorMessage, SurfaceWheelUnit};
use glam::Vec2;

use super::events::{Button, Modifiers};
use super::messages as msg;
use super::targets::Targets;
use crate::scene::Scene;

/// How presses count as clicks, and the underlay.
#[derive(Clone, Debug)]
pub struct PointerSettings {
    pub underlay: Option<String>,
    /// The start of the ids of the underlay's own pages: the windows its script lays out in pages
    /// of their own (ADR 0201). The keys treat each as the underlay: a press on one waits for the
    /// page's answer, and the page's keymap runs its keys.
    pub pages: Option<String>,
    /// The OS's double-click time.
    pub double_click: Duration,
    /// How far, in screen pixels, a second press may land from the first and still count.
    pub slop: f32,
}

impl Default for PointerSettings {
    fn default() -> Self {
        PointerSettings {
            underlay: None,
            pages: None,
            double_click: Duration::from_millis(500),
            slop: 4.0,
        }
    }
}

impl PointerSettings {
    /// Whether `surface` is the underlay's: the underlay, or one of its own pages.
    pub fn page_owned(&self, surface: &str) -> bool {
        self.underlay.as_deref() == Some(surface)
            || self
                .pages
                .as_deref()
                .is_some_and(|p| surface.starts_with(p))
    }
}

#[derive(Clone, Copy, Debug)]
struct Press {
    at: Vec2,
    button: Button,
    when: Instant,
    clicks: u64,
}

/// Where the pointer is and who hears it.
#[derive(Clone, Debug, Default)]
pub struct Pointer {
    pub at: Vec2,
    pub held: Vec<Button>,
    /// The surface that took the press the buttons belong to.
    pub capture: Option<String>,
    /// The surfaces that think the pointer is in them now.
    pub hearing: Vec<String>,
    /// The surface the next press goes to whatever lies under it: the window manager's grips lie
    /// over the edges of a window's surfaces, and the page finds them (#80).
    pub press_to: Option<String>,
    last: Option<Press>,
    /// The press held now went further than a click's slop: it is a drag, and the next press
    /// starts counting clicks again.
    dragged: bool,
}

impl Pointer {
    /// The surface topmost under the pointer, at its own point.
    fn under(&self, scene: &Scene, targets: &Targets) -> Option<(String, Vec2)> {
        targets.surface_at(scene, self.at)
    }

    /// Who hears the pointer with `main` the surface it is for: it, the window's own page it lies
    /// in (ADR 0201), and the underlay when `main` is another surface.
    fn listeners(main: Option<&str>, settings: &PointerSettings, targets: &Targets) -> Vec<String> {
        let mut all: Vec<String> = main.map(str::to_owned).into_iter().collect();
        if let Some(page) = main.and_then(|m| targets.page_of(m))
            && Some(page) != main
        {
            all.push(page.to_owned());
        }
        if let Some(underlay) = settings.underlay.as_deref()
            && main.is_some_and(|m| m != underlay)
        {
            all.push(underlay.to_owned());
        }
        all
    }

    /// Hand the pointer to `now`, telling the ones that lose it.
    fn hand_over(&mut self, now: Vec<String>) -> Vec<CompositorMessage> {
        let gone: Vec<CompositorMessage> = self
            .hearing
            .iter()
            .filter(|s| !now.contains(s))
            .map(|s| msg::pointer_leave(s))
            .collect();
        self.hearing = now;
        gone
    }

    fn point_in(&self, surface: &str, targets: &Targets, under: Option<&(String, Vec2)>) -> Vec2 {
        match under {
            Some((s, at)) if s == surface => *at,
            _ => targets.to_local(surface, self.at).unwrap_or(Vec2::ZERO),
        }
    }

    /// The pointer moved to `at` (or the scene changed under it).
    pub fn moved(
        &mut self,
        scene: &Scene,
        targets: &Targets,
        at: Vec2,
        mods: Modifiers,
        settings: &PointerSettings,
    ) -> Vec<CompositorMessage> {
        self.at = at;
        if !self.held.is_empty() && self.last.is_some_and(|p| p.at.distance(at) > settings.slop) {
            self.dragged = true;
        }
        let under = self.under(scene, targets);
        let main = self
            .capture
            .clone()
            .or_else(|| under.as_ref().map(|(s, _)| s.clone()));
        let listeners = Self::listeners(main.as_deref(), settings, targets);
        let mut out = self.hand_over(listeners.clone());
        for surface in &listeners {
            let point = self.point_in(surface, targets, under.as_ref());
            out.push(msg::pointer_move(surface, point, &self.held, mods));
        }
        out
    }

    /// A button went down or up at the pointer; returns the messages and the surface a press
    /// landed on.
    #[allow(clippy::too_many_arguments)]
    pub fn button(
        &mut self,
        scene: &Scene,
        targets: &Targets,
        button: Button,
        pressed: bool,
        mods: Modifiers,
        now: Instant,
        settings: &PointerSettings,
    ) -> (Vec<CompositorMessage>, Option<String>) {
        let mut under = self.under(scene, targets);
        if pressed {
            if self.held.contains(&button) {
                return (Vec::new(), None);
            }
            if let Some(surface) = self.press_to.take().filter(|_| self.held.is_empty()) {
                let at = targets.to_local(&surface, self.at).unwrap_or(Vec2::ZERO);
                under = Some((surface, at));
            }
            if self.held.is_empty() {
                self.capture = under.as_ref().map(|(s, _)| s.clone());
            }
            self.held.push(button);
            let clicks = self.count(button, now, settings);
            let listeners = Self::listeners(self.capture.as_deref(), settings, targets);
            let mut out = self.hand_over(listeners.clone());
            for surface in &listeners {
                let point = self.point_in(surface, targets, under.as_ref());
                out.push(msg::pointer_button(
                    surface, point, button, true, &self.held, clicks, mods,
                ));
            }
            return (out, self.capture.clone());
        }
        if !self.held.contains(&button) {
            return (Vec::new(), None);
        }
        self.held.retain(|b| *b != button);
        let clicks = self
            .last
            .filter(|p| p.button == button)
            .map_or(1, |p| p.clicks);
        let listeners = Self::listeners(self.capture.as_deref(), settings, targets);
        let mut out: Vec<CompositorMessage> = listeners
            .iter()
            .map(|surface| {
                let point = self.point_in(surface, targets, under.as_ref());
                msg::pointer_button(surface, point, button, false, &self.held, clicks, mods)
            })
            .collect();
        if self.held.is_empty() && std::mem::take(&mut self.dragged) {
            // A drag is no click: a press right after it in the same place is a first click.
            self.last = None;
        }
        if self.held.is_empty() && self.capture.take().is_some() {
            // Released: the pointer belongs to what is under it again.
            let main = under.as_ref().map(|(s, _)| s.clone());
            out.extend(self.hand_over(Self::listeners(main.as_deref(), settings, targets)));
        }
        (out, None)
    }

    fn count(&mut self, button: Button, now: Instant, settings: &PointerSettings) -> u64 {
        let clicks = match self.last {
            Some(p)
                if p.button == button
                    && now.saturating_duration_since(p.when) <= settings.double_click
                    && p.at.distance(self.at) <= settings.slop =>
            {
                p.clicks + 1
            }
            _ => 1,
        };
        self.last = Some(Press {
            at: self.at,
            button,
            when: now,
            clicks,
        });
        clicks
    }

    /// A wheel or trackpad scroll: to the surface under the pointer alone, pixel deltas in its own
    /// pixels.
    pub fn wheel(
        &self,
        scene: &Scene,
        targets: &Targets,
        delta: (f64, f64),
        unit: SurfaceWheelUnit,
        mods: Modifiers,
    ) -> Vec<CompositorMessage> {
        let Some((surface, at)) = self.under(scene, targets) else {
            return Vec::new();
        };
        let delta = if unit == SurfaceWheelUnit::Pixel {
            let per = targets.per_screen_px(&surface);
            (delta.0 * f64::from(per.x), delta.1 * f64::from(per.y))
        } else {
            delta
        };
        vec![msg::pointer_wheel(&surface, at, delta, unit, mods)]
    }

    /// The pointer left the window: everyone hearing it is told, unless a press holds it.
    pub fn left(&mut self) -> Vec<CompositorMessage> {
        if self.capture.is_some() {
            return Vec::new();
        }
        self.hand_over(Vec::new())
    }

    /// A surface left the desk: it hears nothing more.
    pub fn forget(&mut self, surface: &str) {
        self.hearing.retain(|s| s != surface);
        if self.capture.as_deref() == Some(surface) {
            self.capture = None;
        }
    }
}
