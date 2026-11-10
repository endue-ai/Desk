//! The glyph atlas the compositor manages: two textures, one of coverage masks (R8) and one of
//! colour glyphs (RGBA8, emoji), packed with etagere. A page grows (doubling, its glyphs copied
//! along) when a frame's glyphs do not fit; at the device's limit, glyphs the frame does not use are
//! evicted first.

use cosmic_text::{CacheKey, SwashContent, SwashImage};
use etagere::{AllocId, BucketedAtlasAllocator, size2};
use std::collections::HashMap;

/// The side a page starts at.
const START: u32 = 512;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Kind {
    Mask = 0,
    Color = 1,
}

/// Where a glyph's bitmap is: its page, its texels, and how it sits on the glyph's origin.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Slot {
    pub kind: Kind,
    /// Texels in the page, `x y w h`; zero size for a glyph with nothing to draw (a space).
    pub texels: [u32; 4],
    /// From the glyph's origin to the bitmap's top-left, in raster pixels, y down.
    pub left: i32,
    pub top: i32,
}

struct Entry {
    slot: Slot,
    alloc: Option<AllocId>,
    used: u64,
}

pub(crate) struct Page {
    pub texture: wgpu::Texture,
    pub view: wgpu::TextureView,
    alloc: BucketedAtlasAllocator,
    format: wgpu::TextureFormat,
}

impl Page {
    fn new(device: &wgpu::Device, format: wgpu::TextureFormat, side: u32) -> Page {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("desk-compositor glyphs"),
            size: wgpu::Extent3d {
                width: side,
                height: side,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_DST
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let alloc = BucketedAtlasAllocator::new(size2(side as i32, side as i32));
        Page {
            texture,
            view,
            alloc,
            format,
        }
    }

    pub fn side(&self) -> u32 {
        self.texture.width()
    }

    /// A page twice the side holding the same texels at the same places.
    fn grown(&self, device: &wgpu::Device, queue: &wgpu::Queue) -> Page {
        let side = self.side() * 2;
        let mut next = Page::new(device, self.format, side);
        next.alloc = self.alloc.clone();
        next.alloc.grow(size2(side as i32, side as i32));
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("desk-compositor glyphs grow"),
        });
        encoder.copy_texture_to_texture(
            self.texture.as_image_copy(),
            next.texture.as_image_copy(),
            self.texture.size(),
        );
        queue.submit([encoder.finish()]);
        next
    }
}

/// The two pages and every glyph in them.
pub(crate) struct Atlas {
    pub mask: Page,
    pub color: Page,
    glyphs: HashMap<CacheKey, Entry>,
    max_side: u32,
    /// Bumped whenever a page is replaced, so its bind group is made again.
    pub generation: u64,
}

impl Atlas {
    pub fn new(device: &wgpu::Device) -> Atlas {
        let max_side = device.limits().max_texture_dimension_2d.min(8192);
        let start = START.min(max_side);
        Atlas {
            mask: Page::new(device, wgpu::TextureFormat::R8Unorm, start),
            color: Page::new(device, wgpu::TextureFormat::Rgba8Unorm, start),
            glyphs: HashMap::new(),
            max_side,
            generation: 0,
        }
    }

    /// The glyph's slot, if it is in the atlas; marks it used in `frame`.
    pub fn get(&mut self, key: &CacheKey, frame: u64) -> Option<Slot> {
        let entry = self.glyphs.get_mut(key)?;
        entry.used = frame;
        Some(entry.slot)
    }

    pub fn len(&self) -> usize {
        self.glyphs.len()
    }

    /// Forget every glyph (new fonts).
    pub fn clear(&mut self) {
        self.glyphs.clear();
        self.mask.alloc.clear();
        self.color.alloc.clear();
    }

    /// Put a rasterised glyph in (or an empty slot for `None`): grow its page, or evict glyphs no
    /// frame since `frame` used, when it does not fit. `None` when it cannot fit at all.
    pub fn insert(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        key: CacheKey,
        image: Option<&SwashImage>,
        frame: u64,
    ) -> Option<Slot> {
        let Some(image) = image.filter(|i| i.placement.width > 0 && i.placement.height > 0) else {
            let slot = Slot {
                kind: Kind::Mask,
                texels: [0; 4],
                left: 0,
                top: 0,
            };
            let entry = Entry {
                slot,
                alloc: None,
                used: frame,
            };
            self.glyphs.insert(key, entry);
            return Some(slot);
        };
        let kind = match image.content {
            SwashContent::Color => Kind::Color,
            SwashContent::Mask | SwashContent::SubpixelMask => Kind::Mask,
        };
        let (w, h) = (image.placement.width, image.placement.height);
        let alloc = self.allocate(device, queue, kind, w, h, frame)?;
        let page = self.page(kind);
        let origin = alloc.rectangle.min;
        let (x, y) = (origin.x as u32, origin.y as u32);
        // The padding texels are written too (zero), so an evicted glyph's never shows at an edge.
        let data = padded(&pixels(image, kind), w, h, bytes(kind));
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &page.texture,
                mip_level: 0,
                origin: wgpu::Origin3d { x, y, z: 0 },
                aspect: wgpu::TextureAspect::All,
            },
            &data,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some((w + 1) * bytes(kind)),
                rows_per_image: Some(h + 1),
            },
            wgpu::Extent3d {
                width: w + 1,
                height: h + 1,
                depth_or_array_layers: 1,
            },
        );
        let slot = Slot {
            kind,
            texels: [x, y, w, h],
            left: image.placement.left,
            top: image.placement.top,
        };
        let entry = Entry {
            slot,
            alloc: Some(alloc.id),
            used: frame,
        };
        self.glyphs.insert(key, entry);
        Some(slot)
    }

    pub fn page(&self, kind: Kind) -> &Page {
        match kind {
            Kind::Mask => &self.mask,
            Kind::Color => &self.color,
        }
    }

    fn page_mut(&mut self, kind: Kind) -> &mut Page {
        match kind {
            Kind::Mask => &mut self.mask,
            Kind::Color => &mut self.color,
        }
    }

    fn allocate(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        kind: Kind,
        w: u32,
        h: u32,
        frame: u64,
    ) -> Option<etagere::Allocation> {
        // A texel of space around each glyph keeps linear filtering from bleeding neighbours in.
        let size = size2(w as i32 + 1, h as i32 + 1);
        let mut evicted = false;
        loop {
            if let Some(alloc) = self.page_mut(kind).alloc.allocate(size) {
                return Some(alloc);
            }
            let side = self.page(kind).side();
            if side < self.max_side {
                let grown = self.page(kind).grown(device, queue);
                *self.page_mut(kind) = grown;
                self.generation += 1;
            } else if !evicted {
                self.evict(kind, frame);
                evicted = true;
            } else {
                return None;
            }
        }
    }

    /// Drop every glyph of `kind` no frame since `frame` used.
    fn evict(&mut self, kind: Kind, frame: u64) {
        let stale: Vec<CacheKey> = self
            .glyphs
            .iter()
            .filter(|(_, e)| e.slot.kind == kind && e.used < frame)
            .map(|(k, _)| *k)
            .collect();
        for key in stale {
            if let Some(Entry {
                alloc: Some(id), ..
            }) = self.glyphs.remove(&key)
            {
                self.page_mut(kind).alloc.deallocate(id);
            }
        }
    }
}

fn bytes(kind: Kind) -> u32 {
    match kind {
        Kind::Mask => 1,
        Kind::Color => 4,
    }
}

/// `w` x `h` texels of `bytes` each, with a column and a row of zeros after them.
fn padded(texels: &[u8], w: u32, h: u32, bytes: u32) -> Vec<u8> {
    let row = (w * bytes) as usize;
    let mut out = vec![0; ((w + 1) * (h + 1) * bytes) as usize];
    for (y, line) in texels.chunks_exact(row).take(h as usize).enumerate() {
        let at = y * (row + bytes as usize);
        out[at..at + row].copy_from_slice(line);
    }
    out
}

/// The image's texels in its page's format: a mask's coverage as is, a colour glyph as RGBA (a
/// subpixel mask, which this compositor never asks for, is averaged to coverage).
fn pixels(image: &SwashImage, kind: Kind) -> Vec<u8> {
    match (image.content, kind) {
        (SwashContent::SubpixelMask, _) => image
            .data
            .as_chunks::<4>()
            .0
            .iter()
            .map(|&[r, g, b, _]| ((u16::from(r) + u16::from(g) + u16::from(b)) / 3) as u8)
            .collect(),
        _ => image.data.clone(),
    }
}
