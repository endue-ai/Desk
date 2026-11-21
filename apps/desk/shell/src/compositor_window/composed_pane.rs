//! A plugin's picture held aside until its window's frame is of its size (ADR 0227). A window's
//! frame is drawn at the size of its own page's picture (ADR 0211), and a
//! pane in it at what that frame leaves. The pane's plugin is told each new size in the same step
//! as the window's page, but paints it sooner: CEF holds a page's next size until it has painted
//! the last, and the window's page takes about a step of a fast resize longer. Drawn as it came,
//! the plugin's picture ran a step ahead of the frame around it. So a plugin's paint
//! of a size other than its pane's, as last drawn, is copied into a texture aside, and its picture
//! stays the one of the frame's size; the scene that draws its pane at a size aside shows that
//! picture (`Composed::panes_drawn`). A paint of a size the pane has left is drawn as it comes: there
//! the plugin trails its frame. At most `KEPT` sizes wait, the newest, and at most
//! `MOST_ASIDE` paints go aside in a row, a count, not a time: a plugin whose pane never takes its
//! size still shows.

use std::collections::HashMap;

use desk_compositor::TextureId;

use super::Composed;

/// The most paints of a plugin put aside in a row, between two pictures shown.
const MOST_ASIDE: usize = 8;
/// The sizes of a plugin kept aside: its window's page trails it by up to three steps of a fast
/// resize when it skips one (ADR 0227, Measurements).
const KEPT: usize = 4;

/// The sizes a pane was last drawn at kept: a paint of one of them trails the frame.
const DRAWN_KEPT: usize = 16;

/// Whether two sizes in device pixels are one to a pixel (a size in CSS pixels rounds).
fn near(a: (u32, u32), b: (u32, u32)) -> bool {
    a.0.abs_diff(b.0) <= 1 && a.1.abs_diff(b.1) <= 1
}

/// Where a paint of a plugin goes.
#[derive(Debug, PartialEq, Eq)]
pub enum To {
    /// The plugin's picture, drawn in its pane.
    Shown,
    /// The texture aside in `slot`; `fresh` when it starts a picture there.
    Aside { slot: usize, fresh: bool },
}

/// One plugin's pane as last drawn and its pictures aside, oldest first.
#[derive(Default)]
pub struct PaneAside {
    /// The pane's size as the last scene drew it, in device pixels (`None`: not drawn).
    want: Option<(u32, u32)>,
    /// The sizes it was drawn at before, oldest first.
    past: Vec<(u32, u32)>,
    aside: Vec<((u32, u32), TextureId)>,
    in_a_row: usize,
    /// The texture its last paint went to: one to another texture is copied whole.
    last: Option<TextureId>,
}

impl PaneAside {
    /// Where a paint of `size` device pixels goes, the plugin's picture being `shown` pixels.
    pub fn paint(&mut self, size: (u32, u32), shown: Option<(u32, u32)>) -> To {
        let fits = self.want.is_none_or(|w| near(w, size));
        let same = shown.is_none_or(|s| s == size);
        // Of a size the pane has left: the plugin trails its frame, and its newest picture is the
        // nearest it has.
        let late = self.past.iter().any(|p| near(*p, size));
        if fits || same || late || self.in_a_row >= MOST_ASIDE {
            self.in_a_row = 0;
            return To::Shown;
        }
        self.in_a_row += 1;
        if let Some(slot) = self.aside.iter().position(|(s, _)| *s == size) {
            return To::Aside { slot, fresh: false };
        }
        To::Aside {
            slot: self.aside.len().min(KEPT),
            fresh: true,
        }
    }

    /// The pane was drawn `size` device pixels: the picture aside of that size, if one waits.
    pub fn drawn(&mut self, size: (u32, u32), shown: Option<(u32, u32)>) -> Option<TextureId> {
        if let Some(before) = self.want.replace(size).filter(|b| !near(*b, size)) {
            self.past.retain(|p| !near(*p, size));
            self.past.push(before);
            if self.past.len() > DRAWN_KEPT {
                self.past.remove(0);
            }
        }
        if shown.is_some_and(|s| near(s, size)) {
            return None;
        }
        let at = self.aside.iter().position(|(s, _)| near(*s, size))?;
        self.in_a_row = 0;
        Some(self.aside.remove(at).1)
    }
}

/// Every plugin's pane and pictures aside, by surface.
#[derive(Default)]
pub struct Panes(HashMap<String, PaneAside>);

impl Composed {
    /// The texture `surface`'s paint of `size` pixels is copied into, whether it is aside, and
    /// whether it must be copied whole (the paint before went to another texture).
    pub(super) fn pane_texture(
        &mut self,
        surface: &str,
        size: (u32, u32),
    ) -> (TextureId, bool, bool) {
        let shown = self.texture(surface);
        if !self.panes.0.contains_key(surface) {
            return (shown, false, false);
        }
        let had = self.shown_size(surface);
        let to = self.panes.0.get_mut(surface).map(|p| p.paint(size, had));
        let (id, aside) = match to {
            Some(To::Aside { slot, fresh }) => {
                let id = if fresh {
                    self.aside_slot(surface, slot, size)
                } else {
                    self.panes.0[surface].aside[slot].1
                };
                (id, true)
            }
            _ => {
                self.pane_stale(surface, size);
                (shown, false)
            }
        };
        let pane = self.panes.0.get_mut(surface);
        let whole = pane.is_some_and(|p| p.last.replace(id).is_some_and(|last| last != id));
        (id, aside, whole)
    }

    /// A texture for a picture of `size` aside in `slot` of `surface`: a new one, or the oldest's
    /// place once `KEPT` wait.
    fn aside_slot(&mut self, surface: &str, slot: usize, size: (u32, u32)) -> TextureId {
        self.next += 1;
        let id = TextureId(self.next);
        let Some(pane) = self.panes.0.get_mut(surface) else {
            return id;
        };
        let gone = (slot >= KEPT).then(|| pane.aside.remove(0).1);
        pane.aside.push((size, id));
        if let Some(gone) = gone {
            self.frames.destroy(&mut self.compositor, gone);
        }
        crate::frame_trace::line(
            "pane_aside",
            serde_json::json!({ "surface": surface, "size": [size.0, size.1] }),
        );
        id
    }

    /// The scene drew each of `panes` (a plugin's surface, its pane's size in device pixels): a
    /// picture aside of a pane's size becomes that plugin's picture, and the plugins it drew no
    /// more keep nothing aside. Whether any picture changed, so the scene is laid out again.
    pub fn panes_drawn(&mut self, panes: &[(String, (u32, u32))]) -> bool {
        let gone: Vec<String> = (self.panes.0.keys())
            .filter(|s| !panes.iter().any(|(p, _)| p == *s))
            .cloned()
            .collect();
        for surface in gone {
            self.pane_gone(&surface);
        }
        let mut changed = false;
        for (surface, size) in panes {
            let had = self.texture_of(surface).and_then(|id| self.frames.size(id));
            let pane = self.panes.0.entry(surface.clone()).or_default();
            let Some(picture) = pane.drawn(*size, had) else {
                continue;
            };
            if let Some(before) = self.textures.insert(surface.clone(), picture) {
                self.retire(before);
            }
            crate::frame_trace::line(
                "pane_shown",
                serde_json::json!({ "surface": surface, "size": [size.0, size.1] }),
            );
            changed = true;
        }
        self.dirty |= changed;
        changed
    }

    /// Whether plugin `surface` has a picture of `size` device pixels aside (ADR 0233).
    pub(super) fn pane_aside_of(&self, surface: &str, size: (u32, u32)) -> bool {
        (self.panes.0.get(surface)).is_some_and(|p| p.aside.iter().any(|(s, _)| near(*s, size)))
    }

    /// `surface`'s picture takes a paint of `size`: one of that size aside is its past.
    fn pane_stale(&mut self, surface: &str, size: (u32, u32)) {
        let Some(pane) = self.panes.0.get_mut(surface) else {
            return;
        };
        let Some(at) = pane.aside.iter().position(|(s, _)| *s == size) else {
            return;
        };
        let id = pane.aside.remove(at).1;
        self.frames.destroy(&mut self.compositor, id);
    }

    /// `surface`'s paint into `id` aside failed: that picture aside goes.
    pub(super) fn pane_aside_failed(&mut self, surface: &str, id: TextureId) {
        let Some(pane) = self.panes.0.get_mut(surface) else {
            return;
        };
        pane.aside.retain(|(_, a)| *a != id);
        pane.last = None;
    }

    /// `surface` is drawn no more, or gone: its pictures aside go.
    pub(super) fn pane_gone(&mut self, surface: &str) {
        let Some(pane) = self.panes.0.remove(surface) else {
            return;
        };
        for (_, id) in pane.aside {
            self.frames.destroy(&mut self.compositor, id);
        }
    }
}

#[cfg(test)]
#[path = "composed_pane_tests.rs"]
mod tests;
