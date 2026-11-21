//! A window's own page's picture held aside until its panes' plugins have pictures of the sizes it
//! leaves them (ADR 0233). A window drawn from its own page has its frame at that page's picture's
//! size (ADR 0211), and each pane in it at what that frame leaves; a plugin's paint ahead of its
//! pane waits for that frame (ADR 0227). The other way: when the window's page painted a size
//! before a pane's plugin did, the frame grew and the plugin was drawn cropped or padded in it. So
//! a window page's paint of a new size, in a window with a plugin pane, is copied into a texture
//! aside, and the scene that finds every pane's plugin with a picture of the size that frame leaves
//! it (shown or aside) shows it (`Composed::pages_wait`). Counts, not times: at most `KEPT` sizes
//! wait, the newest; after `MOST_ASIDE` paints aside in a row the next is drawn as it comes, and
//! after `MOST_LOOKS` scenes laid out with one waiting the newest is shown: a plugin that never
//! paints its size, or a page whose plugin is gone, still shows.

use std::collections::{BTreeSet, HashMap};

use desk_compositor::{Rect, TextureId};

use super::Composed;
use crate::compositor_window::draw::anchor::{self, Anchor};

/// The most paints of a window's page put aside in a row, between two pictures shown.
const MOST_ASIDE: usize = 8;
/// The scenes laid out while a picture of the page waits, before its newest is shown anyway.
const MOST_LOOKS: usize = 8;
/// The sizes of a window's page kept aside, the newest.
const KEPT: usize = 4;

/// Whether two sizes in device pixels are one to a pixel (a size in CSS pixels rounds).
pub fn near(a: (u32, u32), b: (u32, u32)) -> bool {
    a.0.abs_diff(b.0) <= 1 && a.1.abs_diff(b.1) <= 1
}

/// A window drawn from its own page with plugin panes, as the scene would draw it now.
#[derive(Clone, Debug)]
pub struct Paned {
    /// Its own page's surface.
    pub page: String,
    /// Its place, at rest on whole device pixels or on its way, and its size as laid out.
    pub placed: Rect,
    pub laid: (f32, f32),
    /// The corner a picture of another size is drawn from.
    pub corner: Anchor,
    /// Each live plugin's surface and its pane's body, from the window's top left.
    pub panes: Vec<(String, Rect)>,
}

impl Paned {
    /// The size, in device pixels, a picture of the window's page of `size` leaves each plugin's
    /// pane: the frame drawn at that size, each pane in it as `draw::window` draws it.
    pub fn leaves(&self, size: (u32, u32), scale: f32) -> Vec<(&str, (u32, u32))> {
        let at = anchor::pictured(self.placed, size, scale, self.corner);
        let px = |v: f32| (v * scale).round().max(1.0) as u32;
        (self.panes.iter())
            .map(|(surface, body)| {
                let to = anchor::within(*body, self.laid, (at.width, at.height));
                (surface.as_str(), (px(to.width), px(to.height)))
            })
            .collect()
    }
}

/// Whether a window of `panes` panes waits for its plugin: one pane only. A lone pane lies at fixed
/// insets from the frame, so `Paned::leaves` is what its plugin was told for each size; a split's
/// panes take a share of the body (`desk_wm::host::panes`), which the scene draws from the newest
/// plan's (`anchor::within`), so for a size before it no pane's size is what its plugin painted,
/// and the wait would end only by its counts.
pub fn waits_for(panes: usize) -> bool {
    panes == 1
}

/// Where a paint of a window's page goes.
#[derive(Debug, PartialEq, Eq)]
pub enum To {
    /// Its picture, drawn with its window: the pictures aside are older and go.
    Shown,
    /// Aside: into the picture of its size that waits, or a new one (`None`).
    Aside(Option<TextureId>),
}

/// One window page's pictures aside, oldest first.
#[derive(Default)]
pub struct PageWait {
    aside: Vec<((u32, u32), TextureId)>,
    in_a_row: usize,
    looks: usize,
    /// The texture its last paint went to: one to another texture is copied whole.
    pub(super) last: Option<TextureId>,
}

impl PageWait {
    /// Where a paint of `size` goes, the page's picture being `shown` pixels, in a window with a
    /// plugin pane when `paned`.
    pub fn paint(&mut self, size: (u32, u32), shown: Option<(u32, u32)>, paned: bool) -> To {
        let same = shown.is_none_or(|s| s == size);
        if !paned || same || self.in_a_row >= MOST_ASIDE {
            self.in_a_row = 0;
            self.looks = 0;
            return To::Shown;
        }
        self.in_a_row += 1;
        // Repainted, it is the newest picture aside.
        let at = self.aside.iter().position(|(s, _)| *s == size);
        let had = at.map(|at| self.aside.remove(at));
        if let Some(had) = had {
            self.aside.push(had);
        }
        To::Aside(had.map(|(_, id)| id))
    }

    /// A new picture of `size` aside in `id`: the oldest past `KEPT`, if one, goes.
    pub fn keep(&mut self, size: (u32, u32), id: TextureId) -> Option<TextureId> {
        self.aside.push((size, id));
        (self.aside.len() > KEPT).then(|| self.aside.remove(0).1)
    }

    /// Every picture aside, which a newer one shown leaves behind.
    pub fn clear(&mut self) -> Vec<TextureId> {
        self.aside.drain(..).map(|(_, id)| id).collect()
    }

    /// Whether a picture waits.
    pub fn waits(&self) -> bool {
        !self.aside.is_empty()
    }

    /// A scene is laid out: the newest picture aside whose size `ready` finds every pane a picture
    /// for, or the newest once `MOST_LOOKS` scenes have waited. Returns that picture and the older
    /// ones it leaves behind.
    pub fn pick(
        &mut self,
        ready: impl Fn((u32, u32)) -> bool,
    ) -> Option<(TextureId, Vec<TextureId>)> {
        if self.aside.is_empty() {
            return None;
        }
        self.looks += 1;
        let found = self.aside.iter().rposition(|(s, _)| ready(*s));
        let at = found.or((self.looks > MOST_LOOKS).then(|| self.aside.len() - 1))?;
        let mut taken: Vec<TextureId> = self.aside.drain(..=at).map(|(_, id)| id).collect();
        let picture = taken.pop()?;
        self.looks = 0;
        self.in_a_row = 0;
        Some((picture, taken))
    }
}

/// Every window page's pictures aside, by surface, and the pages with plugin panes.
#[derive(Default)]
pub struct Pages {
    waits: HashMap<String, PageWait>,
    paned: BTreeSet<String>,
}

impl Composed {
    /// The texture window page `surface`'s paint of `size` pixels is copied into, whether it is
    /// aside, and whether it must be copied whole (the paint before went to another texture).
    pub(super) fn page_wait_texture(
        &mut self,
        surface: &str,
        size: (u32, u32),
    ) -> (TextureId, bool, bool) {
        let shown = self.texture(surface);
        let had = self.frames.size(shown);
        let paned = self.pages.paned.contains(surface);
        let wait = self.pages.waits.entry(surface.to_owned()).or_default();
        let (id, aside) = match wait.paint(size, had, paned) {
            To::Shown => {
                for gone in wait.clear() {
                    self.frames.destroy(&mut self.compositor, gone);
                }
                (shown, false)
            }
            To::Aside(Some(id)) => (id, true),
            To::Aside(None) => {
                self.next += 1;
                let id = TextureId(self.next);
                let gone = wait.keep(size, id);
                if let Some(gone) = gone {
                    self.frames.destroy(&mut self.compositor, gone);
                }
                crate::frame_trace::line(
                    "page_aside",
                    serde_json::json!({ "surface": surface, "size": [size.0, size.1] }),
                );
                (id, true)
            }
        };
        let wait = self.pages.waits.get_mut(surface);
        let whole = wait.is_some_and(|w| w.last.replace(id).is_some_and(|last| last != id));
        // The next scene looks whether its panes' plugins have pictures of its size.
        self.dirty |= aside;
        (id, aside, whole)
    }

    /// Whether a window's page waits for its panes' plugins: their paints lay the scene out again.
    pub(super) fn pages_waiting(&self) -> bool {
        self.pages.waits.values().any(PageWait::waits)
    }

    /// Whether plugin `surface` has a picture of `size` device pixels, drawn or aside, or none at
    /// all to wait for.
    fn pictured(&self, surface: &str, size: (u32, u32)) -> bool {
        let Some(id) = self.texture_of(surface) else {
            return true;
        };
        self.frames.size(id).is_some_and(|s| near(s, size)) || self.pane_aside_of(surface, size)
    }

    /// A scene is laid out with `paned`, the windows drawn from their own page with plugin panes:
    /// each window page's picture aside whose panes' plugins all have pictures of the sizes it
    /// leaves them becomes its picture. Whether any did.
    pub fn pages_wait(&mut self, paned: &[Paned], scale: f32) -> bool {
        self.pages.paned = paned.iter().map(|p| p.page.clone()).collect();
        let mut waits = std::mem::take(&mut self.pages.waits);
        let mut picked = Vec::new();
        for (surface, wait) in waits.iter_mut().filter(|(_, w)| w.waits()) {
            // A window no more drawn with plugin panes waits for nothing.
            let window = paned.iter().find(|p| &p.page == surface);
            let ready = |size: (u32, u32)| {
                window.is_none_or(|w| {
                    (w.leaves(size, scale).iter()).all(|(s, z)| self.pictured(s, *z))
                })
            };
            if let Some(found) = wait.pick(ready) {
                picked.push((surface.clone(), found));
            }
        }
        self.pages.waits = waits;
        let changed = !picked.is_empty();
        for (surface, (picture, older)) in picked {
            for gone in older {
                self.frames.destroy(&mut self.compositor, gone);
            }
            if let Some(before) = self.textures.insert(surface.clone(), picture) {
                self.frames.destroy(&mut self.compositor, before);
            }
            crate::frame_trace::line("page_shown", serde_json::json!({ "surface": surface }));
        }
        // One still waiting looks again at the next scene: a count of scenes ends the wait.
        self.dirty |= changed || self.pages_waiting();
        changed
    }

    /// `surface`'s paint into `id`, a texture aside, failed: that picture goes, a window page's, a
    /// plugin's (ADR 0227) or the desk's page's (#330), so none is shown that holds no paint.
    pub(super) fn aside_failed(&mut self, surface: &str, id: TextureId) {
        if let Some(wait) = self.pages.waits.get_mut(surface) {
            wait.aside.retain(|(_, a)| *a != id);
            wait.last = None;
        }
        self.pane_aside_failed(surface, id);
        self.page_aside_failed(surface, id);
        self.frames.destroy(&mut self.compositor, id);
    }

    /// Window page `surface` is gone: its pictures aside go.
    pub(super) fn page_wait_gone(&mut self, surface: &str) {
        let Some(mut wait) = self.pages.waits.remove(surface) else {
            return;
        };
        for id in wait.clear() {
            self.frames.destroy(&mut self.compositor, id);
        }
    }
}

#[cfg(test)]
#[path = "composed_window_tests.rs"]
mod tests;
