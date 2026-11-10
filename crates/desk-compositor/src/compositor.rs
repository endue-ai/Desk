//! The compositor: draws a [`Scene`] into a texture view the caller owns (a swapchain image, an
//! off-screen target), only when something changed or animates.

use crate::draw_list::{self, DrawItem, ItemKind};
use crate::node::NodeKind;
use crate::pipelines::{ITEM_SIZE, Pipelines};
use crate::scene::{Scene, Wallpaper};
use crate::text::{Fonts, TextSystem};
use crate::types::{Rect, TextureId, union};
use std::collections::{BTreeSet, HashMap};
use std::time::{Duration, Instant};

/// What one [`Compositor::render`] call did.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct FrameStats {
    /// Whether a frame was drawn; `false` when nothing was damaged and nothing animates, and the
    /// target was left untouched (do not present it).
    pub drawn: bool,
    /// The screen region that changed since the last drawn frame (the whole frame is redrawn).
    pub damage: Option<Rect>,
    /// CPU time spent walking the scene, encoding and submitting (the GPU runs after).
    pub compose_time: Duration,
    /// Leaf nodes that produced pixels (rects, surfaces, text; the wallpaper is not counted).
    pub nodes_drawn: usize,
    pub draw_calls: usize,
    pub textures_resident: usize,
    /// Surfaces skipped because their texture is not registered.
    pub missing_textures: usize,
    /// Glyphs the frame's text nodes drew, and how many of them no font had.
    pub glyphs: usize,
    pub missing_glyphs: usize,
    /// Some node animates: schedule the next frame.
    pub animating: bool,
}

struct Registered {
    texture: wgpu::Texture,
    group: wgpu::BindGroup,
}

/// What the compositor last drew of one scene, and the textures that changed since.
struct Seen {
    revision: u64,
    size: (u32, u32),
    dirty: BTreeSet<TextureId>,
}

/// Draws scenes into texture views. One compositor can draw several scenes (one per display,
/// sharing the registered textures); it remembers what it last drew of each.
pub struct Compositor {
    device: wgpu::Device,
    queue: wgpu::Queue,
    format: wgpu::TextureFormat,
    pipelines: Pipelines,
    stride: u64,
    uniforms: wgpu::Buffer,
    uniforms_group: wgpu::BindGroup,
    capacity: usize,
    textures: HashMap<TextureId, Registered>,
    seen: HashMap<u64, Seen>,
    items: Vec<DrawItem>,
    staging: Vec<u8>,
    text: TextSystem,
}

impl Compositor {
    /// A compositor drawing into targets of `format` (prefer a non-sRGB one; see [`crate::Color`]).
    pub fn new(device: &wgpu::Device, queue: &wgpu::Queue, format: wgpu::TextureFormat) -> Self {
        let pipelines = Pipelines::new(device, format);
        let align = u64::from(device.limits().min_uniform_buffer_offset_alignment);
        let stride = ITEM_SIZE.div_ceil(align) * align;
        let capacity = 64;
        let uniforms = item_buffer(device, stride, capacity);
        let uniforms_group = pipelines.items_group(device, &uniforms);
        Compositor {
            device: device.clone(),
            queue: queue.clone(),
            format,
            pipelines,
            stride,
            uniforms,
            uniforms_group,
            capacity,
            textures: HashMap::new(),
            seen: HashMap::new(),
            items: Vec::new(),
            staging: Vec::new(),
            text: TextSystem::default(),
        }
    }

    pub fn format(&self) -> wgpu::TextureFormat {
        self.format
    }

    pub fn device(&self) -> &wgpu::Device {
        &self.device
    }

    pub fn queue(&self) -> &wgpu::Queue {
        &self.queue
    }

    /// Make `texture` drawable as `id` (replacing an earlier one). It needs `TEXTURE_BINDING` usage
    /// and a filterable float format (BGRA8 or RGBA8, premultiplied alpha).
    pub fn register_texture(&mut self, id: TextureId, texture: &wgpu::Texture) {
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let group = self.pipelines.texture_group(&self.device, &view);
        let registered = Registered {
            texture: texture.clone(),
            group,
        };
        self.textures.insert(id, registered);
        self.mark_dirty(id);
    }

    /// Say `id` has new pixels: in the same texture (cheap, call it on every paint) or in a new one.
    pub fn update_texture(&mut self, id: TextureId, texture: &wgpu::Texture) {
        match self.textures.get(&id) {
            Some(known) if known.texture == *texture => self.mark_dirty(id),
            _ => self.register_texture(id, texture),
        }
    }

    /// Forget `id`; surfaces showing it stop drawing until it is registered again.
    pub fn remove_texture(&mut self, id: TextureId) {
        if self.textures.remove(&id).is_some() {
            self.mark_dirty(id);
        }
    }

    fn mark_dirty(&mut self, id: TextureId) {
        for seen in self.seen.values_mut() {
            seen.dirty.insert(id);
        }
    }

    pub fn textures_resident(&self) -> usize {
        self.textures.len()
    }

    /// Draw the next frame of every scene whatever changed (a new target, a lost swapchain).
    pub fn invalidate(&mut self) {
        self.seen.clear();
    }

    /// Forget what was last drawn of `scene`, a scene that is going (a thumbnail's pass, a
    /// snapshot's): its next frame, if any, is drawn whole.
    pub fn forget(&mut self, scene: &Scene) {
        self.seen.remove(&scene.id());
    }

    /// Set text in `fonts` from now on; without, the machine's fonts load with the first text.
    /// Every scene draws again.
    pub fn set_fonts(&mut self, fonts: Fonts) {
        self.text.set_fonts(fonts);
        self.invalidate();
    }

    /// The fonts text is set in (the machine's, loaded now, when none were set).
    pub fn fonts(&mut self) -> &mut Fonts {
        self.text.fonts()
    }

    /// Glyphs the atlas holds.
    pub fn glyphs_resident(&self) -> usize {
        self.text.atlas_glyphs()
    }

    /// The side of the glyph atlas's larger page in texels: 512 to start, doubling as glyphs need
    /// room, up to the device's limit.
    pub fn atlas_side(&self) -> u32 {
        self.text.atlas_side()
    }

    /// Draw `scene` into `target` (`size` pixels, the compositor's format) if anything changed
    /// since the last drawn frame or something animates; otherwise do nothing. Keep the scene's
    /// viewport equal to `size` ([`Scene::resize`]): the camera follows the scene, the scissor the
    /// target. A drawn frame is a full redraw, so a fresh swapchain image is fine.
    pub fn render(
        &mut self,
        scene: &Scene,
        target: &wgpu::TextureView,
        size: (u32, u32),
    ) -> FrameStats {
        let start = Instant::now();
        let full = scene.camera().full();
        let seen = self.seen.get(&scene.id()).filter(|s| s.size == size);
        let mut damage = match seen {
            Some(seen) => union(
                scene.damage_since(seen.revision),
                texture_damage(scene, &seen.dirty),
            ),
            None => Some(full),
        };
        let animating = scene.is_animating();
        if animating {
            let moving = scene.animating().filter_map(|id| scene.screen_bounds(id));
            damage = moving.fold(damage, |d, r| union(d, Some(r)));
        }
        if damage.is_none() && !animating {
            return FrameStats {
                textures_resident: self.textures.len(),
                compose_time: start.elapsed(),
                ..FrameStats::default()
            };
        }
        let textures = &self.textures;
        let size_of = |id: TextureId| {
            let t = &textures.get(&id)?.texture;
            Some((t.width(), t.height()))
        };
        self.text.begin();
        let counts = draw_list::build(scene, &size_of, &mut self.text, &mut self.items);
        self.text.finish(&self.device, &self.queue);
        let pipelines = &self.pipelines;
        self.text.refresh_group(&self.device, |d, mask, color| {
            pipelines.atlas_group(d, mask, color)
        });
        self.upload();
        let draw_calls = self.encode(scene, target, size);
        let seen = Seen {
            revision: scene.revision(),
            size,
            dirty: BTreeSet::new(),
        };
        self.seen.insert(scene.id(), seen);
        FrameStats {
            drawn: true,
            damage: damage.and_then(|d| d.intersect(&full)),
            compose_time: start.elapsed(),
            nodes_drawn: counts.nodes_drawn,
            draw_calls,
            textures_resident: self.textures.len(),
            missing_textures: counts.missing_textures,
            glyphs: self.text.queued(),
            missing_glyphs: self.text.missing,
            animating,
        }
    }

    fn upload(&mut self) {
        if self.items.len() > self.capacity {
            self.capacity = self.items.len().next_power_of_two();
            self.uniforms = item_buffer(&self.device, self.stride, self.capacity);
            self.uniforms_group = self.pipelines.items_group(&self.device, &self.uniforms);
        }
        let stride = self.stride as usize;
        self.staging.clear();
        self.staging.resize(self.items.len() * stride, 0);
        for (item, chunk) in self.items.iter().zip(self.staging.chunks_exact_mut(stride)) {
            chunk[..ITEM_SIZE as usize].copy_from_slice(bytemuck::bytes_of(&item.uniform));
        }
        if !self.staging.is_empty() {
            self.queue.write_buffer(&self.uniforms, 0, &self.staging);
        }
    }

    fn encode(&self, scene: &Scene, target: &wgpu::TextureView, size: (u32, u32)) -> usize {
        let clear = match scene.wallpaper() {
            Wallpaper::Solid(c) => wgpu::Color {
                r: f64::from(c.r * c.a),
                g: f64::from(c.g * c.a),
                b: f64::from(c.b * c.a),
                a: f64::from(c.a),
            },
            _ => wgpu::Color::BLACK,
        };
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("desk-compositor"),
            });
        let mut draws = 0;
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("desk-compositor"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: target,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(clear),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                ..Default::default()
            });
            let target_rect = Rect::new(0.0, 0.0, size.0 as f32, size.1 as f32);
            if let Some(glyphs) = self.text.buffer() {
                pass.set_vertex_buffer(0, glyphs.slice(..));
            }
            let mut current: Option<&wgpu::RenderPipeline> = None;
            for (index, item) in self.items.iter().enumerate() {
                let scissor = item.scissor.unwrap_or(target_rect).intersect(&target_rect);
                let Some(scissor) = scissor.map(|s| s.round_out()) else {
                    continue;
                };
                let (pipeline, group, instances) = match item.kind {
                    ItemKind::Shape => (&self.pipelines.shape, None, 0..1),
                    ItemKind::Surface(id) => match self.textures.get(&id) {
                        Some(t) => (&self.pipelines.surface, Some(&t.group), 0..1),
                        None => continue,
                    },
                    ItemKind::Text { first, count } => match self.text.group() {
                        Some(atlas) => (&self.pipelines.glyph, Some(atlas), first..first + count),
                        None => continue,
                    },
                };
                if current != Some(pipeline) {
                    pass.set_pipeline(pipeline);
                    current = Some(pipeline);
                }
                pass.set_scissor_rect(
                    scissor.x as u32,
                    scissor.y as u32,
                    (scissor.width as u32).min(size.0 - scissor.x as u32),
                    (scissor.height as u32).min(size.1 - scissor.y as u32),
                );
                let offset = (index as u64 * self.stride) as u32;
                pass.set_bind_group(0, &self.uniforms_group, &[offset]);
                if let Some(group) = group {
                    pass.set_bind_group(1, group, &[]);
                }
                pass.draw(0..6, instances);
                draws += 1;
            }
        }
        self.queue.submit([encoder.finish()]);
        draws
    }
}

fn item_buffer(device: &wgpu::Device, stride: u64, capacity: usize) -> wgpu::Buffer {
    device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("desk-compositor items"),
        size: stride * capacity as u64,
        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    })
}

/// Where the surfaces (and the wallpaper) showing a texture in `dirty` are.
fn texture_damage(scene: &Scene, dirty: &BTreeSet<TextureId>) -> Option<Rect> {
    if dirty.is_empty() {
        return None;
    }
    if let Wallpaper::Texture(id) = scene.wallpaper()
        && dirty.contains(&id)
    {
        return Some(scene.camera().full());
    }
    scene
        .nodes()
        .filter(|(_, node)| match &node.kind {
            NodeKind::Surface(s) => dirty.contains(&s.texture),
            _ => false,
        })
        .filter_map(|(id, _)| scene.screen_bounds(id))
        .reduce(|a, b| a.union(&b))
}
