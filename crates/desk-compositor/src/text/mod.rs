//! Chrome text (ADR 0146): cosmic-text shapes and lays out (system font discovery, fallback across
//! Latin, Hangul, CJK and emoji), swash rasterises with subpixel positioning, and the compositor
//! packs the glyphs into its own atlas and draws them as instanced quads in paint order, through
//! the node's transform, opacity and clips like any other node.

mod atlas;
mod fonts;
mod layout;
mod style;

pub use fonts::Fonts;
pub use style::{FontStack, TextAlign, TextNode, TextStyle};

use crate::types::Color;
use atlas::{Atlas, Slot};
use bytemuck::Zeroable;
use cosmic_text::CacheKey;
use glam::{Mat4, Vec2};
use layout::Layouts;
use std::ops::Range;

/// One glyph quad (`GlyphIn` in `shaders.wgsl`): its box in the node's units, its texels in the
/// atlas page (normalised), its colour (straight alpha) and which page.
#[repr(C)]
#[derive(Clone, Copy, Debug, bytemuck::Pod, bytemuck::Zeroable)]
pub(crate) struct GlyphInstance {
    rect: [f32; 4],
    uv: [f32; 4],
    color: [f32; 4],
    kind: [u32; 4],
}

pub(crate) const GLYPH_SIZE: u64 = std::mem::size_of::<GlyphInstance>() as u64;

/// A glyph a frame queued: what to rasterise, where its origin lands in raster pixels, and how
/// raster pixels map back to the node's units (`local = (raster - offset) / scale`).
struct Pending {
    key: CacheKey,
    x: i32,
    y: i32,
    color: Color,
    scale: f32,
    offset: Vec2,
}

/// The compositor's text state: fonts, cached layouts, the atlas and this frame's glyphs.
#[derive(Default)]
pub(crate) struct TextSystem {
    fonts: Option<Fonts>,
    layouts: Layouts,
    atlas: Option<Atlas>,
    pending: Vec<Pending>,
    instances: Vec<GlyphInstance>,
    buffer: Option<wgpu::Buffer>,
    group: Option<(u64, wgpu::BindGroup)>,
    frame: u64,
    /// Glyphs this frame no font had.
    pub missing: usize,
}

impl TextSystem {
    pub fn set_fonts(&mut self, fonts: Fonts) {
        self.fonts = Some(fonts);
        self.layouts.clear();
        if let Some(atlas) = &mut self.atlas {
            atlas.clear();
        }
    }

    /// The fonts in use; the machine's, loaded now, when none were given.
    pub fn fonts(&mut self) -> &mut Fonts {
        self.fonts.get_or_insert_with(Fonts::system)
    }

    /// Glyphs resident in the atlas.
    pub fn atlas_glyphs(&self) -> usize {
        self.atlas.as_ref().map_or(0, Atlas::len)
    }

    /// The side of the atlas's larger page, in texels (0 before any text).
    pub fn atlas_side(&self) -> u32 {
        let side = |a: &Atlas| a.mask.side().max(a.color.side());
        self.atlas.as_ref().map_or(0, side)
    }

    pub fn begin(&mut self) {
        self.pending.clear();
        self.instances.clear();
        self.missing = 0;
    }

    /// Lay out `node` and queue its glyphs as seen through `world`; the instances it will draw.
    pub fn queue(&mut self, node: &TextNode, world: &Mat4) -> Option<Range<u32>> {
        if node.text.is_empty() || node.rect.is_empty() || node.style.color.a <= 0.0 {
            return None;
        }
        let fonts = self.fonts.get_or_insert_with(Fonts::system);
        let layout = self.layouts.get(fonts, node);
        self.missing += layout.missing;
        let (scale, offset) = raster(world);
        let start = self.pending.len() as u32;
        let origin = node.rect.min();
        for shaped in &layout.glyphs {
            let at = (
                offset.x + scale * origin.x,
                offset.y + scale * (origin.y + shaped.baseline),
            );
            let physical = shaped.glyph.physical(at, scale);
            self.pending.push(Pending {
                key: physical.cache_key,
                x: physical.x,
                y: physical.y,
                color: node.style.color,
                scale,
                offset,
            });
        }
        let end = self.pending.len() as u32;
        (end > start).then_some(start..end)
    }

    /// Rasterise and pack what the frame queued, and write its instances for the GPU.
    pub fn finish(&mut self, device: &wgpu::Device, queue: &wgpu::Queue) {
        self.layouts.end_frame();
        self.frame += 1;
        if self.pending.is_empty() {
            return;
        }
        let frame = self.frame;
        let atlas = self.atlas.get_or_insert_with(|| Atlas::new(device));
        let fonts = self.fonts.get_or_insert_with(Fonts::system);
        let slots: Vec<Option<Slot>> = self
            .pending
            .iter()
            .map(|p| {
                atlas.get(&p.key, frame).or_else(|| {
                    let image = fonts.swash.get_image_uncached(&mut fonts.system, p.key);
                    atlas.insert(device, queue, p.key, image.as_ref(), frame)
                })
            })
            .collect();
        // Texels become uvs only now: a page may have grown on the way.
        let sides = [atlas.mask.side() as f32, atlas.color.side() as f32];
        for (p, slot) in self.pending.iter().zip(slots) {
            let instance = match slot {
                Some(slot) if slot.texels[2] > 0 => place(p, &slot, sides[slot.kind as usize]),
                _ => GlyphInstance::zeroed(),
            };
            self.instances.push(instance);
        }
        let bytes = self.instances.len() as u64 * GLYPH_SIZE;
        if self.buffer.as_ref().is_none_or(|b| b.size() < bytes) {
            self.buffer = Some(device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("desk-compositor glyphs"),
                size: bytes.next_power_of_two().max(GLYPH_SIZE * 256),
                usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            }));
        }
        if let Some(buffer) = &self.buffer {
            queue.write_buffer(buffer, 0, bytemuck::cast_slice(&self.instances));
        }
    }

    /// The instance buffer of the frame, once `finish` wrote one.
    pub fn buffer(&self) -> Option<&wgpu::Buffer> {
        self.buffer.as_ref()
    }

    /// Make the atlas's bind group again if a page was replaced since.
    pub fn refresh_group(
        &mut self,
        device: &wgpu::Device,
        make: impl FnOnce(&wgpu::Device, &wgpu::TextureView, &wgpu::TextureView) -> wgpu::BindGroup,
    ) {
        let Some(atlas) = &self.atlas else { return };
        if self
            .group
            .as_ref()
            .is_none_or(|(g, _)| *g != atlas.generation)
        {
            let group = make(device, &atlas.mask.view, &atlas.color.view);
            self.group = Some((atlas.generation, group));
        }
    }

    /// The atlas's bind group, once there is an atlas.
    pub fn group(&self) -> Option<&wgpu::BindGroup> {
        self.group.as_ref().map(|(_, g)| g)
    }

    /// Glyphs the frame queued.
    pub fn queued(&self) -> usize {
        self.pending.len()
    }
}

/// A glyph's quad in its node's units and its uvs.
fn place(p: &Pending, slot: &Slot, side: f32) -> GlyphInstance {
    let [tx, ty, tw, th] = slot.texels.map(|v| v as f32);
    let x0 = (p.x + slot.left) as f32;
    let y0 = (p.y - slot.top) as f32;
    let local = |x: f32, y: f32| (Vec2::new(x, y) - p.offset) / p.scale;
    let (a, b) = (local(x0, y0), local(x0 + tw, y0 + th));
    GlyphInstance {
        rect: [a.x, a.y, b.x, b.y],
        uv: [tx / side, ty / side, (tx + tw) / side, (ty + th) / side],
        color: p.color.to_array(),
        kind: [slot.kind as u32, 0, 0, 0],
    }
}

/// The scale glyphs are rasterised at and the offset they are placed by. A node seen flat at a
/// uniform scale lands on the screen at `scale * local + offset` exactly, so its glyphs sit on whole
/// pixels plus their subpixel bin; under any other transform (a tilt, a turn) they are rasterised
/// at its rough scale and the sampler filters them. Scales step by sixteenths so a zoom does not
/// rasterise every frame anew.
pub(crate) fn raster(world: &Mat4) -> (f32, Vec2) {
    let (x, y, w) = (world.x_axis, world.y_axis, world.w_axis);
    let rough = x.truncate().length().min(y.truncate().length());
    let scale = ((rough * 16.0).round() / 16.0).clamp(1.0 / 16.0, 8.0);
    let flat = x.y.abs() < 1e-6
        && y.x.abs() < 1e-6
        && x.z.abs() < 1e-6
        && y.z.abs() < 1e-6
        && x.w.abs() < 1e-9
        && y.w.abs() < 1e-9
        && w.z.abs() < 1e-6
        && (w.w - 1.0).abs() < 1e-6
        && (x.x - scale).abs() < 1e-6
        && (y.y - scale).abs() < 1e-6;
    let offset = if flat {
        Vec2::new(w.x, w.y)
    } else {
        Vec2::ZERO
    };
    (scale, offset)
}

#[cfg(test)]
mod tests {
    use super::*;
    use glam::Vec3;

    #[test]
    fn a_flat_node_is_rasterised_where_it_lands() {
        let moved = Mat4::from_translation(Vec3::new(10.25, 4.5, 0.0));
        assert_eq!(raster(&moved), (1.0, Vec2::new(10.25, 4.5)));
        let doubled = moved * Mat4::from_scale(Vec3::new(2.0, 2.0, 1.0));
        assert_eq!(raster(&doubled), (2.0, Vec2::new(10.25, 4.5)));
        let turned = Mat4::from_rotation_z(0.3);
        assert_eq!(raster(&turned).1, Vec2::ZERO);
        let zoomed = Mat4::from_scale(Vec3::new(0.51, 0.51, 1.0));
        assert_eq!(raster(&zoomed), (0.5, Vec2::ZERO), "steps of a sixteenth");
    }
}
