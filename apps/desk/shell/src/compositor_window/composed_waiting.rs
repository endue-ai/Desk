//! A picture of a new size waits for the next layout, and a picture no layout draws retires (#249,
//! ADR 0235). The render thread draws a scene up to most of a display interval after the main
//! thread laid it out (`render_thread.rs`), and a surface node samples its picture at the size the
//! layout saw (`draw::sampled`): a paint that changed a picture's size in place meanwhile would be
//! drawn stretched. So a paint of another size than its surface's picture goes to a texture of its
//! own, and shows from the next layout on (`Composed::show_waiting`), as a paint of a new size did
//! before (it laid the scene out again); a paint of the picture's size is copied into it as it
//! comes, a newer picture of what the scene laid out. A texture no layout draws any more (a
//! picture replaced, a surface gone) retires: the scenes handed before may still draw it, so it
//! goes once the render thread drew one handed since (`Composed::retire_drawn`). The compositor
//! window turns this on (`Composed::wait_for_layouts`); the surface probe, which lays out and draws
//! at once, keeps pictures as they come.

use std::collections::HashMap;

use desk_compositor::TextureId;

use super::Composed;

/// The pictures waiting for the next layout and the textures retired.
#[derive(Default)]
pub struct Waiting {
    /// A render thread draws the scenes laid out: new sizes wait, and textures retire.
    on: bool,
    /// Each surface's newest paint of another size than its picture.
    next: HashMap<String, TextureId>,
    /// The texture each surface's last paint shown went to: a paint to the other is copied whole.
    last: HashMap<String, TextureId>,
    /// The textures no layout draws, each with the last frame handed that may draw it.
    retired: Vec<(TextureId, u64)>,
    /// The last frame handed to the render thread.
    handed: u64,
}

impl Composed {
    /// Where a paint of `surface` of `size` pixels that is shown goes, `id` its picture: into the
    /// picture when of its size, else into the texture that waits for the next layout; and whether
    /// it is copied whole (`whole`, or it goes to another texture than the paint before).
    pub(super) fn shown_texture(
        &mut self,
        surface: &str,
        id: TextureId,
        size: (u32, u32),
        whole: bool,
    ) -> (TextureId, bool) {
        if !self.waiting.on {
            return (id, whole);
        }
        let resized = self.frames.size(id).is_some_and(|had| had != size);
        let to = if resized {
            self.dirty = true;
            match self.waiting.next.get(surface) {
                Some(next) => *next,
                None => {
                    self.next += 1;
                    let next = TextureId(self.next);
                    self.waiting.next.insert(surface.to_owned(), next);
                    next
                }
            }
        } else {
            // Of its picture's size again: what waited is older than this paint.
            self.drop_waiting(surface);
            id
        };
        let moved = (self.waiting.last.insert(surface.to_owned(), to)).is_some_and(|l| l != to);
        (to, whole || moved)
    }

    /// The size `surface`'s picture has, or has from the next layout on.
    pub(super) fn shown_size(&self, surface: &str) -> Option<(u32, u32)> {
        let next = self.waiting.next.get(surface).copied();
        self.frames.size(next.or_else(|| self.texture_of(surface))?)
    }

    /// `surface`'s picture waiting for the next layout, if one does, goes.
    pub(super) fn drop_waiting(&mut self, surface: &str) {
        if let Some(stale) = self.waiting.next.remove(surface) {
            self.frames.destroy(&mut self.compositor, stale);
        }
    }

    /// A scene is about to be laid out: every picture that waited for it is its surface's now.
    pub fn show_waiting(&mut self) {
        for (surface, next) in std::mem::take(&mut self.waiting.next) {
            if let Some(before) = self.textures.insert(surface, next) {
                self.retire(before);
            }
        }
    }

    /// A render thread draws the scenes laid out from now on (the compositor window's).
    pub fn wait_for_layouts(&mut self) {
        self.waiting.on = true;
    }

    /// No layout draws `id` from now on: it goes once the render thread drew a frame handed since,
    /// or at once where no render thread draws.
    pub(super) fn retire(&mut self, id: TextureId) {
        if self.waiting.on {
            self.waiting.retired.push((id, self.waiting.handed));
        } else {
            self.frames.destroy(&mut self.compositor, id);
        }
    }

    /// Frame `n` goes to the render thread.
    pub fn handed(&mut self, n: u64) {
        self.waiting.handed = n;
    }

    /// The render thread drew frame `n`: the textures retired before it was handed go.
    pub fn retire_drawn(&mut self, n: u64) {
        let (gone, kept) = std::mem::take(&mut self.waiting.retired)
            .into_iter()
            .partition(|(_, handed)| *handed < n);
        self.waiting.retired = kept;
        for (id, _) in gone {
            self.frames.destroy(&mut self.compositor, id);
        }
    }

    /// `surface` is gone: what it waited with goes, and its picture retires.
    pub(super) fn forget_waiting(&mut self, surface: &str) {
        self.drop_waiting(surface);
        self.waiting.last.remove(surface);
    }
}

#[cfg(test)]
#[path = "composed_waiting_tests.rs"]
mod tests;
