//! What is on screen: desk-compositor's demo desk (`examples/shared`: N drifting, tilting, titled
//! windows in the endue look), optionally one plugin window whose content a CEF browser paints, and
//! a pointer the compositor draws itself (no hardware cursor plane yet). Input goes through the
//! compositor's own `InputRouter`, which hit-tests the scene and speaks the surface protocol.

use crate::demo;
use desk_compositor::glam::Vec2;
use desk_compositor::input::keymap::Platform;
use desk_compositor::input::{Input, InputRouter, Out, PointerSettings, Target};
use desk_compositor::*;
use std::path::Path;
use std::time::Instant;

/// The plugin window's surface id in the surface protocol, and its texture.
pub const PLUGIN: &str = "plugin.cef";
const PLUGIN_TEXTURE: TextureId = TextureId(10_000);

pub struct Desk {
    pub demo: demo::Desk,
    pub compositor: Compositor,
    pub router: InputRouter,
    cursor: NodeId,
    plugin: Option<NodeId>,
    /// The plugin window's content size in pixels: the CEF view size at scale 1.
    #[cfg_attr(not(feature = "cef"), allow(dead_code))]
    pub plugin_size: (u32, u32),
    size: (u32, u32),
}

impl Desk {
    pub fn new(
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        format: wgpu::TextureFormat,
        size: (u32, u32),
        windows: usize,
        plugin: bool,
    ) -> Desk {
        let mut compositor = Compositor::new(device, queue, format);
        let theme = ChromeTheme::from_tokens(&demo::look(""));
        let mut demo = demo::build(size, windows, &mut compositor, theme);
        let (mut plugin_node, mut plugin_size) = (None, (0, 0));
        if plugin {
            let (node, content) = plugin_window(&mut demo, &mut compositor, size);
            plugin_node = Some(node);
            plugin_size = content;
        }
        let root = demo.scene.root();
        let center = Vec2::new(size.0 as f32 / 2.0, size.1 as f32 / 2.0);
        let cursor = demo
            .scene
            .insert(root, Node::from(cursor_rect(center)).with_hit(false))
            .expect("the cursor node");
        Desk {
            demo,
            compositor,
            router: InputRouter::new(Platform::Other, PointerSettings::default()),
            cursor,
            plugin: plugin_node,
            plugin_size,
            size,
        }
    }

    pub fn animate(&mut self, t: f32) {
        demo::animate(&mut self.demo, &mut self.compositor, t);
    }

    pub fn render(&mut self, view: &wgpu::TextureView) -> FrameStats {
        self.compositor.render(&self.demo.scene, view, self.size)
    }

    pub fn move_cursor(&mut self, at: (f32, f32)) {
        let _ = self.demo.scene.set(
            self.cursor,
            Node::from(cursor_rect(Vec2::new(at.0, at.1))).with_hit(false),
        );
    }

    /// One input event through the compositor's router: messages for the plugin surface, keys the
    /// desk's keymap takes, cursor and IME requests.
    pub fn route(&mut self, input: &Input) -> Vec<Out> {
        if let Some(node) = self.plugin {
            // The window does not move here, but a real desk maps its surfaces every layout.
            self.router.targets.clear();
            let target = Target {
                surface: PLUGIN.into(),
                origin: Vec2::ZERO,
                per_unit: Vec2::ONE,
            };
            self.router.targets.surface(&self.demo.scene, node, target);
        }
        self.router.handle(&self.demo.scene, input, Instant::now())
    }

    /// The plugin's newest paint: the same texture again (software paint) or a new one (imported).
    #[cfg_attr(not(feature = "cef"), allow(dead_code))]
    pub fn plugin_painted(&mut self, texture: &wgpu::Texture) {
        self.compositor.update_texture(PLUGIN_TEXTURE, texture);
    }

    /// Draw the scene once more into an off-screen target and write it as PNG.
    pub fn capture(&mut self, path: &Path) -> Result<(), String> {
        let (device, queue) = (
            self.compositor.device().clone(),
            self.compositor.queue().clone(),
        );
        let target = headless::Target::new(&device, self.size, self.compositor.format());
        self.compositor.invalidate();
        self.compositor
            .render(&self.demo.scene, &target.view, self.size);
        let rgba = target
            .read_rgba(&device, &queue)
            .map_err(|e| e.to_string())?;
        let file = std::io::BufWriter::new(std::fs::File::create(path).map_err(|e| e.to_string())?);
        let mut encoder = png::Encoder::new(file, self.size.0, self.size.1);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .and_then(|mut w| w.write_image_data(&rgba))
            .map_err(|e| e.to_string())?;
        // The next frame on screen must be a full one again.
        self.compositor.invalidate();
        Ok(())
    }
}

/// A focused window in the middle of the desk whose content is the plugin's surface, waiting on
/// its first paint with a plain dark texture.
fn plugin_window(
    demo: &mut demo::Desk,
    compositor: &mut Compositor,
    size: (u32, u32),
) -> (NodeId, (u32, u32)) {
    let title = demo.chrome.theme().window.title_height;
    let content = (
        (size.0 as f32 * 0.42).floor(),
        (size.1 as f32 * 0.5).floor(),
    );
    let outer = Rect::new(
        ((size.0 as f32 - content.0) / 2.0).floor(),
        ((size.1 as f32 - content.1 - title) / 2.0).floor(),
        content.0,
        content.1 + title,
    );
    let root = demo.scene.root();
    let parts = demo
        .chrome
        .window(
            &mut demo.scene,
            root,
            outer,
            "Plugin — CEF windowless",
            Some("no X11, no Wayland"),
            true,
        )
        .expect("the plugin window");
    let pixels = (content.0 as u32, content.1 as u32);
    let dark = vec![0x20u8; (pixels.0 * pixels.1 * 4) as usize];
    let placeholder = headless::upload_rgba(compositor.device(), compositor.queue(), pixels, &dark);
    compositor.register_texture(PLUGIN_TEXTURE, &placeholder);
    let node = demo
        .scene
        .insert(
            parts.group,
            SurfaceNode {
                radius: 8.0,
                ..SurfaceNode::new(parts.content, PLUGIN_TEXTURE)
            },
        )
        .expect("the plugin surface node");
    (node, pixels)
}

/// The pointer: a small white rectangle with a dark edge, its top left at the hot spot.
fn cursor_rect(at: Vec2) -> RectNode {
    RectNode {
        stroke: Some(Stroke {
            width: 1.5,
            color: Color::hex(0x101418),
        }),
        radius: 2.0,
        ..RectNode::new(Rect::new(at.x, at.y, 11.0, 17.0), Color::WHITE)
    }
}
