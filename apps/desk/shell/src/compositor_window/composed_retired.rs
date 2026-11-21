//! A picture that changes size goes to a texture of its own, and the one it replaces retires (#249,
//! ADR 0235). The render thread draws a scene after the main thread laid it out (`render_thread.rs`),
//! and a surface node samples its picture at the size the layout saw (`draw::sampled`): a picture
//! resized in place meanwhile would be drawn stretched. So a paint of another size than its
//! surface's picture goes to a new texture, which is the picture from then on, at once, as the
//! picture resized in place was before (the desk's page is laid out from the report its picture's
//! size names, `page.rs`); a paint of the picture's size is copied into it as it comes. A texture
//! no layout draws any more (a picture replaced, a surface gone) retires: a scene handed before may
//! still draw it, so it goes once the render thread drew a frame handed since
//! (`Composed::retire_drawn`). The compositor window turns this on (`Composed::render_thread_draws`);
//! the surface probe, which lays out and draws at once, resizes its pictures in place.

use desk_compositor::TextureId;

use super::Composed;

/// The textures retired, and the frames handed to the render thread.
#[derive(Default)]
pub struct Retired {
    /// A render thread draws the scenes laid out: a new size takes a new texture; textures retire.
    on: bool,
    /// The textures no layout draws, each with the last frame handed that may draw it.
    retired: Vec<(TextureId, u64)>,
    /// The last frame handed to the render thread.
    handed: u64,
}

impl Composed {
    /// The texture a paint of `size` pixels shown as `id`'s picture goes to: `id` when of its size,
    /// else a new one (`resized` makes it the picture once the paint is in it).
    pub(super) fn shown_texture(&mut self, id: TextureId, size: (u32, u32)) -> TextureId {
        let resized = self.frames.size(id).is_some_and(|had| had != size);
        if !self.retired.on || !resized {
            return id;
        }
        self.next += 1;
        TextureId(self.next)
    }

    /// `surface`'s paint of a new size went into `to`, its picture being `id`: when it took, `to` is
    /// its picture now and `id` retires; when not, `to` goes and the picture stays.
    pub(super) fn resized(&mut self, surface: &str, id: TextureId, to: TextureId, took: bool) {
        if !took {
            self.frames.destroy(&mut self.compositor, to);
            return;
        }
        if self.textures.get(surface) == Some(&id) {
            self.textures.insert(surface.to_owned(), to);
            self.retire(id);
        }
    }

    /// A render thread draws the scenes laid out from now on (the compositor window's).
    pub fn render_thread_draws(&mut self) {
        self.retired.on = true;
    }

    /// No layout draws `id` from now on: it goes once the render thread drew a frame handed since,
    /// or at once where no render thread draws.
    pub(super) fn retire(&mut self, id: TextureId) {
        if self.retired.on {
            self.retired.retired.push((id, self.retired.handed));
        } else {
            self.frames.destroy(&mut self.compositor, id);
        }
    }

    /// Frame `n` goes to the render thread.
    pub fn handed(&mut self, n: u64) {
        self.retired.handed = n;
    }

    /// The render thread drew frame `n`: the textures retired before it was handed go.
    pub fn retire_drawn(&mut self, n: u64) {
        let (gone, kept) = std::mem::take(&mut self.retired.retired)
            .into_iter()
            .partition(|(_, handed)| *handed < n);
        self.retired.retired = kept;
        for (id, _) in gone {
            self.frames.destroy(&mut self.compositor, id);
        }
    }
}

#[cfg(test)]
#[path = "composed_retired_tests.rs"]
mod tests;
