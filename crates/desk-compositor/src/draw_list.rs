//! The scene flattened into draw items in paint order: one uniform block each, drawn by one of two
//! pipelines (shapes, textured surfaces). Group transforms, opacity and clips are folded in here.

use crate::camera::Camera;
use crate::node::{NodeId, NodeKind, RectNode, SurfaceNode};
use crate::scene::{Scene, Wallpaper};
use crate::text::{TextNode, TextSystem};
use crate::types::{Color, Rect, TextureId};
use glam::Mat4;

/// The shader's per-item block (`Item` in `shaders.wgsl`): 256 bytes, the usual uniform offset
/// alignment, so items sit back to back in one buffer.
#[repr(C)]
#[derive(Clone, Copy, Debug, bytemuck::Pod, bytemuck::Zeroable)]
pub(crate) struct ItemUniform {
    mvp: [[f32; 4]; 4],
    clip_from_local: [[f32; 4]; 4],
    /// The area drawn, `x0 y0 x1 y1` in local units: the shape grown by antialiasing or blur.
    geometry: [f32; 4],
    /// The rounded box, `x0 y0 x1 y1`.
    shape: [f32; 4],
    /// The clip rectangle in the clip's space, `x0 y0 x1 y1`.
    clip: [f32; 4],
    fill: [f32; 4],
    /// The stroke's colour, or the gradient's bottom colour.
    stroke: [f32; 4],
    uv: [f32; 4],
    /// Corner radius, stroke width, opacity, shadow sigma.
    params: [f32; 4],
    /// Mode (see `MODE_*`), then padding.
    mode: [u32; 4],
}

pub(crate) const MODE_SHAPE: u32 = 0;
pub(crate) const MODE_SHADOW: u32 = 1;
pub(crate) const MODE_GRADIENT: u32 = 2;
pub(crate) const MODE_SURFACE: u32 = 3;
pub(crate) const MODE_TEXT: u32 = 4;

const NO_CLIP: [f32; 4] = [-1e9, -1e9, 1e9, 1e9];

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum ItemKind {
    Shape,
    Surface(TextureId),
    /// Glyph instances `first..first + count` of the frame's text.
    Text {
        first: u32,
        count: u32,
    },
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct DrawItem {
    pub kind: ItemKind,
    pub uniform: ItemUniform,
    /// Screen pixels the item may touch (the clips' bounds); `None` for the whole target.
    pub scissor: Option<Rect>,
}

/// What [`build`] produced besides the items.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct BuildCounts {
    pub nodes_drawn: usize,
    /// Surfaces skipped because their texture is not registered.
    pub missing_textures: usize,
}

#[derive(Clone, Copy)]
struct Clip {
    /// Maps the current space into the clip's space.
    from_here: Mat4,
    rect: Rect,
}

#[derive(Clone, Copy)]
struct State {
    world: Mat4,
    opacity: f32,
    clip: Option<Clip>,
    scissor: Option<Rect>,
}

/// Flatten `scene` into `out` (cleared first). `texture_size` answers for registered textures;
/// `text` lays out text nodes and queues their glyphs.
pub(crate) fn build(
    scene: &Scene,
    texture_size: &dyn Fn(TextureId) -> Option<(u32, u32)>,
    text: &mut TextSystem,
    out: &mut Vec<DrawItem>,
) -> BuildCounts {
    out.clear();
    let camera = scene.camera();
    let mut counts = BuildCounts::default();
    wallpaper(scene, &camera, texture_size, out);
    let state = State {
        world: Mat4::IDENTITY,
        opacity: 1.0,
        clip: None,
        scissor: None,
    };
    let mut walk = Walk {
        scene,
        camera: &camera,
        texture_size,
        text,
        out,
        counts: &mut counts,
    };
    walk.visit(scene.root(), state);
    counts
}

fn wallpaper(
    scene: &Scene,
    camera: &Camera,
    texture_size: &dyn Fn(TextureId) -> Option<(u32, u32)>,
    out: &mut Vec<DrawItem>,
) {
    let full = camera.full();
    let base = ItemUniform::new(camera.view_projection, full, full, None);
    match scene.wallpaper() {
        Wallpaper::Solid(_) => {}
        Wallpaper::Gradient { top, bottom } => out.push(DrawItem {
            kind: ItemKind::Shape,
            uniform: ItemUniform {
                fill: top.to_array(),
                stroke: bottom.to_array(),
                mode: [MODE_GRADIENT, 0, 0, 0],
                ..base
            },
            scissor: None,
        }),
        Wallpaper::Texture(id) => {
            let Some((tw, th)) = texture_size(id) else {
                return;
            };
            let (view, tex) = (full.width / full.height, tw as f32 / th.max(1) as f32);
            let uv = if tex > view {
                let w = view / tex;
                Rect::new((1.0 - w) / 2.0, 0.0, w, 1.0)
            } else {
                let h = tex / view;
                Rect::new(0.0, (1.0 - h) / 2.0, 1.0, h)
            };
            out.push(DrawItem {
                kind: ItemKind::Surface(id),
                uniform: ItemUniform {
                    uv: corners(&uv),
                    mode: [MODE_SURFACE, 0, 0, 0],
                    ..base
                },
                scissor: None,
            });
        }
    }
}

struct Walk<'a> {
    scene: &'a Scene,
    camera: &'a Camera,
    texture_size: &'a dyn Fn(TextureId) -> Option<(u32, u32)>,
    text: &'a mut TextSystem,
    out: &'a mut Vec<DrawItem>,
    counts: &'a mut BuildCounts,
}

impl Walk<'_> {
    fn visit(&mut self, id: NodeId, state: State) {
        let Some(entry) = self.scene.entry_of(id) else {
            return;
        };
        match &entry.node.kind {
            NodeKind::Group(group) => {
                let opacity = state.opacity * group.opacity;
                if opacity <= 0.0 {
                    return;
                }
                let world = state.world * group.transform;
                let (clip, scissor) = match group.clip {
                    Some(rect) => {
                        let bounds = self.camera.screen_bounds(&world, &rect);
                        let scissor = match (bounds, state.scissor) {
                            (Some(b), Some(s)) => b.intersect(&s),
                            (b, _) => b,
                        };
                        let Some(scissor) = scissor else { return };
                        let clip = Clip {
                            from_here: Mat4::IDENTITY,
                            rect,
                        };
                        (Some(clip), Some(scissor))
                    }
                    None => {
                        let clip = state.clip.map(|c| Clip {
                            from_here: c.from_here * group.transform,
                            ..c
                        });
                        (clip, state.scissor)
                    }
                };
                let inner = State {
                    world,
                    opacity,
                    clip,
                    scissor,
                };
                for child in &entry.children {
                    self.visit(*child, inner);
                }
            }
            NodeKind::Rect(rect) => self.rect(rect, &state),
            NodeKind::Surface(surface) => self.surface(surface, &state),
            NodeKind::Text(text) => self.text(text, &state),
        }
    }

    fn base(&self, state: &State, geometry: Rect, shape: Rect) -> ItemUniform {
        ItemUniform::new(
            self.camera.view_projection * state.world,
            geometry,
            shape,
            state.clip,
        )
    }

    fn push(&mut self, kind: ItemKind, uniform: ItemUniform, state: &State) {
        self.out.push(DrawItem {
            kind,
            uniform,
            scissor: state.scissor,
        });
    }

    fn rect(&mut self, node: &RectNode, state: &State) {
        let aa = antialias_margin(&state.world);
        let mut drawn = false;
        if let Some(shadow) = node.shadow.filter(|s| s.color.a > 0.0) {
            let shape = node.rect.translate(shadow.offset).inflate(shadow.spread);
            let geometry = shape.inflate(shadow.blur * 1.5 + aa);
            let uniform = ItemUniform {
                fill: shadow.color.to_array(),
                params: [
                    (node.radius + shadow.spread).max(0.0),
                    0.0,
                    state.opacity,
                    shadow.blur / 2.0,
                ],
                mode: [MODE_SHADOW, 0, 0, 0],
                ..self.base(state, geometry, shape)
            };
            self.push(ItemKind::Shape, uniform, state);
            drawn = true;
        }
        let stroke = node.stroke.filter(|s| s.width > 0.0 && s.color.a > 0.0);
        if node.fill.a > 0.0 || stroke.is_some() {
            let stroke = stroke.map_or((0.0, Color::TRANSPARENT), |s| (s.width, s.color));
            let uniform = ItemUniform {
                fill: node.fill.to_array(),
                stroke: stroke.1.to_array(),
                params: [node.radius.max(0.0), stroke.0, state.opacity, 0.0],
                mode: [MODE_SHAPE, 0, 0, 0],
                ..self.base(state, node.rect.inflate(aa), node.rect)
            };
            self.push(ItemKind::Shape, uniform, state);
            drawn = true;
        }
        self.counts.nodes_drawn += usize::from(drawn);
    }

    fn surface(&mut self, node: &SurfaceNode, state: &State) {
        let opacity = state.opacity * node.opacity;
        if opacity <= 0.0 {
            return;
        }
        if (self.texture_size)(node.texture).is_none() {
            self.counts.missing_textures += 1;
            return;
        }
        let aa = antialias_margin(&state.world);
        let uniform = ItemUniform {
            uv: corners(&node.uv),
            params: [node.radius.max(0.0), 0.0, opacity, 0.0],
            mode: [MODE_SURFACE, 0, 0, 0],
            ..self.base(state, node.rect.inflate(aa), node.rect)
        };
        self.push(ItemKind::Surface(node.texture), uniform, state);
        self.counts.nodes_drawn += 1;
    }

    fn text(&mut self, node: &TextNode, state: &State) {
        if state.opacity <= 0.0 {
            return;
        }
        // Text no camera shows is neither laid out nor rasterised.
        if self
            .camera
            .screen_bounds(&state.world, &node.rect)
            .is_none()
        {
            return;
        }
        let Some(glyphs) = self.text.queue(node, &state.world) else {
            return;
        };
        let uniform = ItemUniform {
            params: [0.0, 0.0, state.opacity, 0.0],
            mode: [MODE_TEXT, 0, 0, 0],
            ..self.base(state, node.rect, node.rect)
        };
        let kind = ItemKind::Text {
            first: glyphs.start,
            count: glyphs.end - glyphs.start,
        };
        self.push(kind, uniform, state);
        self.counts.nodes_drawn += 1;
    }
}

impl ItemUniform {
    fn new(mvp: Mat4, geometry: Rect, shape: Rect, clip: Option<Clip>) -> ItemUniform {
        let (clip_from_local, clip) = match clip {
            Some(c) => (c.from_here, corners(&c.rect)),
            None => (Mat4::IDENTITY, NO_CLIP),
        };
        ItemUniform {
            mvp: mvp.to_cols_array_2d(),
            clip_from_local: clip_from_local.to_cols_array_2d(),
            geometry: corners(&geometry),
            shape: corners(&shape),
            clip,
            fill: Color::TRANSPARENT.to_array(),
            stroke: Color::TRANSPARENT.to_array(),
            uv: corners(&Rect::UNIT),
            params: [0.0, 0.0, 1.0, 0.0],
            mode: [MODE_SHAPE, 0, 0, 0],
        }
    }
}

fn corners(rect: &Rect) -> [f32; 4] {
    let (min, max) = (rect.min(), rect.max());
    [min.x, min.y, max.x, max.y]
}

/// Local units per screen pixel and a half, so the antialiased edge has room whatever the scale.
fn antialias_margin(world: &Mat4) -> f32 {
    let scale = world
        .x_axis
        .truncate()
        .length()
        .min(world.y_axis.truncate().length());
    (1.5 / scale.max(1e-3)).min(64.0)
}

#[cfg(test)]
#[path = "draw_list_tests.rs"]
mod tests;
