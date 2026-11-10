//! desk-compositor: the desk's own compositor (#32 §3).
//!
//! A retained [`Scene`] of plain data (a wallpaper, rectangles the desk draws itself, surfaces
//! that other processes rendered into textures, and groups with 2D or 3D transforms, opacity and
//! clips) is drawn by a [`Compositor`] into a `wgpu::TextureView` the caller provides: a window's
//! swapchain image or an off-screen target. Nothing here knows about windows, CEF or input, so the
//! window manager drives it with data, and tests render it headless ([`headless`]).
//!
//! - Units are target pixels, origin top-left, y down; see [`Projection`] for the camera.
//! - Every scene change records the screen region it touched; [`Compositor::render`] draws only
//!   when something changed since the last frame or a node animates, and reports
//!   [`FrameStats`].
//! - [`hit_test`] finds the topmost node under a point through the same transforms.
//! - [`TextNode`]s are set with cosmic-text in [`Fonts`] and drawn from the compositor's own glyph
//!   atlas, through their group like any node (ADR 0146).
//! - The look comes from the flat token table `theme.tokens` carries ([`Tokens`]): [`ChromeTheme`]
//!   reads it, and [`Chrome`] builds window frames, title bars, bars, snap previews, toasts and
//!   placeholders, and restyles them all in one pass when the look changes.
//!
//! ```no_run
//! use desk_compositor::*;
//! let gpu = headless::headless_device()?;
//! let format = wgpu::TextureFormat::Rgba8Unorm;
//! let mut compositor = Compositor::new(&gpu.device, &gpu.queue, format);
//! let mut scene = Scene::new(256, 160);
//! scene.set_wallpaper(Wallpaper::Solid(Color::hex(0x1d2333)));
//! let frame = scene.insert(scene.root(), RectNode::new(Rect::new(20.0, 20.0, 120.0, 80.0), Color::WHITE))?;
//! let target = headless::Target::new(&gpu.device, (256, 160), format);
//! assert!(compositor.render(&scene, &target.view, target.size).drawn);
//! assert!(!compositor.render(&scene, &target.view, target.size).drawn, "nothing changed");
//! assert_eq!(hit_test(&scene, glam::Vec2::new(30.0, 30.0)).map(|h| h.node), Some(frame));
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! ```

pub mod attach;
mod camera;
mod chrome;
mod compositor;
mod damage;
mod draw_list;
pub mod headless;
mod hit;
pub mod input;
mod node;
mod pipelines;
mod scene;
mod text;
mod theme;
mod types;

pub use attach::{AttachError, Attached, Frames, Source};
pub use camera::{DEFAULT_FOV_Y, Projection};
pub use chrome::{Chrome, Role, WindowChrome};
pub use compositor::{Compositor, FrameStats};
pub use hit::{Hit, hit_test};
pub use node::{GroupNode, Node, NodeId, NodeKind, RectNode, SurfaceNode};
pub use scene::{Scene, SceneError, Wallpaper};
pub use text::{FontStack, Fonts, TextAlign, TextNode, TextStyle};
pub use theme::{
    BarStyle, ChromeTheme, PlaceholderStyle, SnapStyle, ToastStyle, Tokens, WindowStyle,
};
pub use types::{Color, Rect, Shadow, Stroke, TextureId};

pub use glam;
pub use wgpu;
