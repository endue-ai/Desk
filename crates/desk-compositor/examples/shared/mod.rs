//! A desk of moving windows for the demo and the compose benchmark: each window is a group (frame
//! with a shadow, title bar, and a surface showing a generated texture) that drifts, turns a
//! little and, every third one, tilts in 3D. Every frame moves every window and repaints every
//! texture, the worst case for damage tracking.
#![allow(dead_code)]

use desk_compositor::glam::{Mat4, Vec2, Vec3};
use desk_compositor::headless::upload_rgba;
use desk_compositor::*;
use std::time::Duration;

pub const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Bgra8Unorm;
const TITLE: f32 = 28.0;

pub struct Window {
    group: NodeId,
    home: Vec2,
    phase: f32,
    texture: TextureId,
}

pub struct Desk {
    pub scene: Scene,
    pub windows: Vec<Window>,
    pub textures: Vec<wgpu::Texture>,
}

/// `count` windows in a grid over a gradient wallpaper, their textures registered with `compositor`.
pub fn build(size: (u32, u32), count: usize, compositor: &mut Compositor) -> Desk {
    let (device, queue) = (compositor.device().clone(), compositor.queue().clone());
    let mut scene = Scene::new(size.0, size.1);
    scene.set_projection(Projection::perspective());
    scene.set_wallpaper(Wallpaper::Gradient {
        top: Color::hex(0x1b2440),
        bottom: Color::hex(0x5a3a6e),
    });
    let columns = (count as f32).sqrt().ceil().max(1.0) as usize;
    let rows = count.div_ceil(columns).max(1);
    let cell = Vec2::new(size.0 as f32 / columns as f32, size.1 as f32 / rows as f32);
    let content = (cell * Vec2::new(0.78, 0.66)).floor();
    let (w, h) = (content.x as u32, content.y as u32);
    let mut windows = Vec::new();
    let mut textures = Vec::new();
    for i in 0..count {
        let texture = TextureId(i as u64 + 1);
        let pixels = pattern((w, h), i);
        let uploaded = upload_rgba(&device, &queue, (w, h), &pixels);
        compositor.register_texture(texture, &uploaded);
        textures.push(uploaded);
        let group = scene.insert(scene.root(), GroupNode::default()).unwrap();
        let outer = Rect::new(
            -content.x / 2.0,
            -content.y / 2.0 - TITLE,
            content.x,
            content.y + TITLE,
        );
        let frame = RectNode {
            radius: 10.0,
            stroke: Some(Stroke {
                width: 1.0,
                color: Color::WHITE.fade(0.25),
            }),
            shadow: Some(Shadow {
                offset: Vec2::new(0.0, 10.0),
                blur: 24.0,
                spread: 0.0,
                color: Color::BLACK.fade(0.45),
            }),
            ..RectNode::new(outer.inflate(1.0), Color::hex(0x23263a))
        };
        scene.insert(group, frame).unwrap();
        let bar = Rect::new(outer.x + 8.0, outer.y + 9.0, 10.0, 10.0);
        for (k, c) in [0xff5f57, 0xfebc2e, 0x28c840].into_iter().enumerate() {
            let dot = RectNode {
                radius: 5.0,
                ..RectNode::new(
                    bar.translate(Vec2::new(16.0 * k as f32, 0.0)),
                    Color::hex(c),
                )
            };
            scene.insert(group, dot).unwrap();
        }
        let surface = SurfaceNode {
            radius: 8.0,
            ..SurfaceNode::new(
                Rect::new(-content.x / 2.0, -content.y / 2.0, content.x, content.y),
                texture,
            )
        };
        scene.insert(group, surface).unwrap();
        let (col, row) = (i % columns, i / columns);
        let home = Vec2::new(
            cell.x * (col as f32 + 0.5),
            cell.y * (row as f32 + 0.5) + TITLE / 2.0,
        );
        windows.push(Window {
            group,
            home,
            phase: i as f32 * 0.7,
            texture,
        });
    }
    Desk {
        scene,
        windows,
        textures,
    }
}

/// Move every window to where it is at time `t` (seconds) and repaint every texture.
pub fn animate(desk: &mut Desk, compositor: &mut Compositor, t: f32) {
    for (i, window) in desk.windows.iter().enumerate() {
        let p = window.phase;
        let drift = Vec2::new((t * 0.7 + p).sin() * 24.0, (t * 0.9 + p).cos() * 16.0);
        let at = window.home + drift;
        let turn = Mat4::from_rotation_z(((t * 0.5 + p).sin() * 2.0).to_radians());
        let tilt = if i % 3 == 0 {
            Mat4::from_rotation_y(((t + p).sin() * 25.0).to_radians())
        } else {
            Mat4::IDENTITY
        };
        let transform = Mat4::from_translation(Vec3::new(at.x, at.y, 0.0)) * tilt * turn;
        desk.scene
            .set(
                window.group,
                GroupNode {
                    transform,
                    ..GroupNode::default()
                },
            )
            .unwrap();
        compositor.update_texture(window.texture, &desk.textures[i]);
    }
}

/// Diagonal stripes in a hue of their own over a vertical fade, like a page with content.
fn pattern(size: (u32, u32), seed: usize) -> Vec<u8> {
    let hue = seed as f32 * 0.37;
    let base = [
        (hue.sin() * 0.5 + 0.5),
        ((hue + 2.1).sin() * 0.5 + 0.5),
        ((hue + 4.2).sin() * 0.5 + 0.5),
    ];
    let mut rgba = Vec::with_capacity((size.0 * size.1 * 4) as usize);
    for y in 0..size.1 {
        let fade = 0.55 + 0.45 * (1.0 - y as f32 / size.1 as f32);
        for x in 0..size.0 {
            let stripe = if ((x + y) / 24) % 2 == 0 { 1.0 } else { 0.8 };
            let line = if y % 40 < 3 && x > 24 && x < size.0 - 24 {
                0.6
            } else {
                1.0
            };
            for c in base {
                rgba.push(((c * 0.8 + 0.2) * fade * stripe * line * 255.0) as u8);
            }
            rgba.push(255);
        }
    }
    rgba
}

/// Min, median, 95th percentile and max of durations, in milliseconds.
pub fn summary(times: &[Duration]) -> [f64; 4] {
    let mut ms: Vec<f64> = times.iter().map(|d| d.as_secs_f64() * 1000.0).collect();
    ms.sort_by(f64::total_cmp);
    let at = |q: f64| ms[((ms.len() - 1) as f64 * q).round() as usize];
    [at(0.0), at(0.5), at(0.95), at(1.0)]
}

pub fn wait(device: &wgpu::Device) {
    let _ = device.poll(wgpu::PollType::wait_indefinitely());
}
