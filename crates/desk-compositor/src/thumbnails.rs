//! Downscaled copies of textures (#54): the canvas map draws each window from one, refreshed by its
//! caller at most ten times a second, and a snapshot bounded in size reads one back. A texture is
//! halved pass after pass until the last pass is within twice the size asked for: every halving
//! samples between four texels, a box filter, so text and edges shrink without the shimmer one
//! bilinear pass from full size gives. Each pass is a scene of one quad drawn by the compositor, so a
//! pass whose source did not change since is not drawn again. A thumbnail is a texture the
//! compositor holds under an id of the high range ([`THUMBNAIL_IDS`]), never one a caller names.

use std::collections::HashMap;

use crate::compositor::Compositor;
use crate::headless::{HeadlessError, Target};
use crate::node::SurfaceNode;
use crate::scene::{Scene, Wallpaper};
use crate::types::{Color, Rect, TextureId};

/// Where thumbnails' texture ids start: callers name textures from 1 up, far below.
pub const THUMBNAIL_IDS: u64 = 1 << 48;

/// Pixels read back: their size, and tightly packed RGBA rows.
pub type Pixels = ((u32, u32), Vec<u8>);

/// One pass: its scene of one quad and the texture it draws into.
struct Pass {
    id: TextureId,
    scene: Scene,
    target: Target,
}

/// A thumbnail: its passes, the last one the thumbnail itself.
struct Thumbnail {
    source_size: (u32, u32),
    size: (u32, u32),
    passes: Vec<Pass>,
}

/// The sizes the passes draw at, from `from` down to `to`: halving while still more than twice
/// as large, then `to`.
pub fn pass_sizes(from: (u32, u32), to: (u32, u32)) -> Vec<(u32, u32)> {
    let to = (to.0.max(1), to.1.max(1));
    let mut sizes = Vec::new();
    let mut at = from;
    while at.0 > to.0 * 2 || at.1 > to.1 * 2 {
        at = (at.0.div_ceil(2).max(to.0), at.1.div_ceil(2).max(to.1));
        sizes.push(at);
    }
    sizes.push(to);
    sizes
}

/// The thumbnails one compositor holds, by the texture each copies.
#[derive(Default)]
pub struct Thumbnails {
    held: HashMap<TextureId, Thumbnail>,
    next: u64,
}

impl Thumbnails {
    pub fn new() -> Thumbnails {
        Thumbnails::default()
    }

    /// Draw texture `source` (`source_size` pixels) down to `size` pixels, as much of it as
    /// changed since the last refresh; the thumbnail's texture id, registered with `compositor`.
    pub fn refresh(
        &mut self,
        compositor: &mut Compositor,
        source: TextureId,
        source_size: (u32, u32),
        size: (u32, u32),
    ) -> TextureId {
        let stale =
            (self.held.get(&source)).is_none_or(|t| t.size != size || t.source_size != source_size);
        if stale {
            if let Some(old) = self.held.remove(&source) {
                forget(compositor, old);
            }
            let passes = (pass_sizes(source_size, size).into_iter())
                .map(|at| self.pass(compositor, at))
                .collect();
            let made = Thumbnail {
                source_size,
                size,
                passes,
            };
            self.held.insert(source, made);
        }
        let thumbnail = self.held.get_mut(&source).expect("just made");
        let mut from = source;
        for pass in &mut thumbnail.passes {
            let (w, h) = pass.target.size;
            let quad = SurfaceNode::new(Rect::new(0.0, 0.0, w as f32, h as f32), from);
            let root = pass.scene.root();
            match pass.scene.children(root).first().copied() {
                Some(node) => {
                    let _ = pass.scene.set(node, quad);
                }
                None => {
                    let _ = pass.scene.insert(root, quad);
                }
            }
            let stats = compositor.render(&pass.scene, &pass.target.view, pass.target.size);
            if stats.drawn {
                // What samples this pass draws again.
                compositor.update_texture(pass.id, &pass.target.texture);
            }
            from = pass.id;
        }
        from
    }

    /// The thumbnail of `source`, if one was made.
    pub fn of(&self, source: TextureId) -> Option<TextureId> {
        Some(self.held.get(&source)?.passes.last()?.id)
    }

    /// The thumbnail of `source` read back as tightly packed RGBA rows, premultiplied.
    pub fn read(
        &self,
        compositor: &Compositor,
        source: TextureId,
    ) -> Option<Result<Pixels, HeadlessError>> {
        let last = self.held.get(&source)?.passes.last()?;
        let rgba = last
            .target
            .read_rgba(compositor.device(), compositor.queue());
        Some(rgba.map(|rgba| (last.target.size, rgba)))
    }

    /// Let go of every thumbnail whose source `keep` does not name, their textures with them.
    pub fn retain(&mut self, compositor: &mut Compositor, keep: impl Fn(TextureId) -> bool) {
        let gone: Vec<TextureId> = (self.held.keys()).filter(|s| !keep(**s)).copied().collect();
        for source in gone {
            if let Some(thumbnail) = self.held.remove(&source) {
                forget(compositor, thumbnail);
            }
        }
    }

    pub fn len(&self) -> usize {
        self.held.len()
    }

    pub fn is_empty(&self) -> bool {
        self.held.is_empty()
    }

    fn pass(&mut self, compositor: &mut Compositor, size: (u32, u32)) -> Pass {
        self.next += 1;
        let id = TextureId(THUMBNAIL_IDS + self.next);
        let target = Target::new(compositor.device(), size, compositor.format());
        compositor.register_texture(id, &target.texture);
        let mut scene = Scene::new(size.0, size.1);
        scene.set_wallpaper(Wallpaper::Solid(Color::TRANSPARENT));
        Pass { id, scene, target }
    }
}

fn forget(compositor: &mut Compositor, thumbnail: Thumbnail) {
    for pass in thumbnail.passes {
        compositor.remove_texture(pass.id);
        compositor.forget(&pass.scene);
    }
}

/// Texture `id` (`size` pixels) read back whole as tightly packed RGBA rows, straight alpha, or
/// at most `max` pixels on each side given with its aspect ratio kept, through a thumbnail: what
/// `ui.surface.snapshot` answers (#54).
pub fn read_texture(
    compositor: &mut Compositor,
    id: TextureId,
    size: (u32, u32),
    max: (Option<u32>, Option<u32>),
) -> Result<Pixels, HeadlessError> {
    let bounded = bounded(size, max);
    let (size, mut rgba) = if bounded == size {
        let mut scene = Scene::new(size.0, size.1);
        scene.set_wallpaper(Wallpaper::Solid(Color::TRANSPARENT));
        let whole = Rect::new(0.0, 0.0, size.0 as f32, size.1 as f32);
        let _ = scene.insert(scene.root(), SurfaceNode::new(whole, id));
        let target = Target::new(compositor.device(), size, compositor.format());
        compositor.render(&scene, &target.view, size);
        compositor.forget(&scene);
        (
            size,
            target.read_rgba(compositor.device(), compositor.queue())?,
        )
    } else {
        let mut thumbnails = Thumbnails::new();
        thumbnails.refresh(compositor, id, size, bounded);
        let read = thumbnails.read(compositor, id);
        thumbnails.retain(compositor, |_| false);
        read.ok_or_else(|| HeadlessError::Readback("no thumbnail".to_owned()))??
    };
    unpremultiply(&mut rgba);
    Ok((size, rgba))
}

/// `size` within `max` on each side given, its aspect ratio kept, never enlarged.
pub fn bounded(size: (u32, u32), max: (Option<u32>, Option<u32>)) -> (u32, u32) {
    let (w, h) = (size.0.max(1) as f64, size.1.max(1) as f64);
    let kx = max.0.map_or(1.0, |m| (f64::from(m) / w).min(1.0));
    let ky = max.1.map_or(1.0, |m| (f64::from(m) / h).min(1.0));
    let k = kx.min(ky);
    if k >= 1.0 {
        return (size.0.max(1), size.1.max(1));
    }
    (
        ((w * k).round() as u32).max(1),
        ((h * k).round() as u32).max(1),
    )
}

/// Premultiplied RGBA to straight, as a PNG holds it.
fn unpremultiply(rgba: &mut [u8]) {
    for px in rgba.as_chunks_mut::<4>().0 {
        let a = px[3];
        if a == 0 || a == 255 {
            continue;
        }
        for c in &mut px[..3] {
            *c = ((u32::from(*c) * 255 + u32::from(a) / 2) / u32::from(a)).min(255) as u8;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passes_halve_until_the_last_is_within_twice_the_size() {
        assert_eq!(
            pass_sizes((2560, 1600), (100, 60)),
            [(1280, 800), (640, 400), (320, 200), (160, 100), (100, 60)]
        );
        assert_eq!(pass_sizes((180, 100), (100, 60)), [(100, 60)]);
        assert_eq!(
            pass_sizes((7, 3), (100, 60)),
            [(100, 60)],
            "never halved up"
        );
    }

    #[test]
    fn a_bound_keeps_the_aspect_ratio_and_never_enlarges() {
        assert_eq!(bounded((800, 600), (Some(400), None)), (400, 300));
        assert_eq!(bounded((800, 600), (Some(400), Some(100))), (133, 100));
        assert_eq!(bounded((800, 600), (Some(4000), None)), (800, 600));
        assert_eq!(bounded((800, 600), (None, None)), (800, 600));
    }

    #[test]
    fn straight_alpha_from_premultiplied() {
        let mut px = [64, 32, 0, 128, 10, 20, 30, 255, 9, 9, 9, 0];
        unpremultiply(&mut px);
        assert_eq!(px, [128, 64, 0, 128, 10, 20, 30, 255, 9, 9, 9, 0]);
    }
}
