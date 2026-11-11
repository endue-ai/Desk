//! The window's cursor from the one the compositor chose (#56): a CSS keyword is one of winit's
//! `CursorIcon`s (`none` hides it), an image a surface drew becomes a custom cursor, made once per
//! image. The image's scale is kept by drawing it at its own size in logical pixels. Over a window's
//! grips and title bar, and while a gesture runs, the window manager's cursor wins over the one of
//! the surface under the pointer (#159 finding 13, `desk_wm::interact::cursor`).

use std::collections::HashMap;

use base64::Engine;
use desk_compositor::input::CursorChoice;
use desk_surface::generated::SurfaceCursorName as N;
use winit::event_loop::ActiveEventLoop;
use winit::window::{CursorIcon, CustomCursor, Window};

/// The OS cursor for a CSS keyword; `None` for `none`, which hides it.
pub fn icon(name: N) -> Option<CursorIcon> {
    Some(match name {
        N::None => return None,
        N::Default => CursorIcon::Default,
        N::ContextMenu => CursorIcon::ContextMenu,
        N::Help => CursorIcon::Help,
        N::Pointer => CursorIcon::Pointer,
        N::Progress => CursorIcon::Progress,
        N::Wait => CursorIcon::Wait,
        N::Cell => CursorIcon::Cell,
        N::Crosshair => CursorIcon::Crosshair,
        N::Text => CursorIcon::Text,
        N::VerticalText => CursorIcon::VerticalText,
        N::Alias => CursorIcon::Alias,
        N::Copy => CursorIcon::Copy,
        N::Move => CursorIcon::Move,
        N::NoDrop => CursorIcon::NoDrop,
        N::NotAllowed => CursorIcon::NotAllowed,
        N::Grab => CursorIcon::Grab,
        N::Grabbing => CursorIcon::Grabbing,
        N::AllScroll => CursorIcon::AllScroll,
        N::ColResize => CursorIcon::ColResize,
        N::RowResize => CursorIcon::RowResize,
        N::NResize => CursorIcon::NResize,
        N::EResize => CursorIcon::EResize,
        N::SResize => CursorIcon::SResize,
        N::WResize => CursorIcon::WResize,
        N::NeResize => CursorIcon::NeResize,
        N::NwResize => CursorIcon::NwResize,
        N::SeResize => CursorIcon::SeResize,
        N::SwResize => CursorIcon::SwResize,
        N::EwResize => CursorIcon::EwResize,
        N::NsResize => CursorIcon::NsResize,
        N::NeswResize => CursorIcon::NeswResize,
        N::NwseResize => CursorIcon::NwseResize,
        N::ZoomIn => CursorIcon::ZoomIn,
        N::ZoomOut => CursorIcon::ZoomOut,
    })
}

/// A PNG's pixels as RGBA, with its size.
pub fn rgba_of(png_base64: &str) -> Option<(Vec<u8>, u32, u32)> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(png_base64)
        .ok()?;
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::ALPHA);
    let mut reader = decoder.read_info().ok()?;
    let mut pixels = vec![0; reader.output_buffer_size()?];
    let frame = reader.next_frame(&mut pixels).ok()?;
    let (w, h) = (frame.width, frame.height);
    let rgba = match frame.color_type {
        png::ColorType::Rgba => pixels[..w as usize * h as usize * 4].to_vec(),
        png::ColorType::GrayscaleAlpha => pixels[..w as usize * h as usize * 2]
            .as_chunks::<2>()
            .0
            .iter()
            .flat_map(|[g, a]| [*g, *g, *g, *a])
            .collect(),
        _ => return None,
    };
    Some((rgba, w, h))
}

/// The window manager's cursor for a CSS keyword it names (`desk_wm::interact::cursor`).
pub fn named(css: &str) -> Option<N> {
    serde_json::from_value(serde_json::Value::String(css.to_owned())).ok()
}

/// The custom cursors made so far, by image; the surfaces' choice, and the window manager's, which
/// wins over it while it has one (#159 finding 13: the grips lie over the surfaces' edges).
#[derive(Default)]
pub struct Cursors {
    custom: HashMap<String, CustomCursor>,
    surfaces: Option<CursorChoice>,
    wm: Option<N>,
}

impl Cursors {
    /// Show `choice`, the surfaces', on `window`, unless the window manager has a cursor of its own.
    pub fn show(&mut self, window: &Window, event_loop: &ActiveEventLoop, choice: &CursorChoice) {
        if let CursorChoice::Image { png, hotspot, .. } = choice
            && !self.custom.contains_key(png)
        {
            let made = rgba_of(png).and_then(|(rgba, w, h)| {
                let (x, y) = (
                    hotspot.0.min(u64::from(w)) as u16,
                    hotspot.1.min(u64::from(h)) as u16,
                );
                CustomCursor::from_rgba(rgba, w as u16, h as u16, x, y).ok()
            });
            if let Some(source) = made {
                self.custom
                    .insert(png.clone(), event_loop.create_custom_cursor(source));
            }
        }
        self.surfaces = Some(choice.clone());
        if self.wm.is_none() {
            self.apply(window, choice);
        }
    }

    /// The window manager's cursor where the pointer is now (`None`: the surfaces' again).
    pub fn over(&mut self, window: &Window, wm: Option<N>) {
        if self.wm == wm {
            return;
        }
        self.wm = wm;
        match (wm, self.surfaces.clone()) {
            (Some(name), _) => self.apply(window, &CursorChoice::Named(name)),
            (None, Some(choice)) => self.apply(window, &choice),
            (None, None) => self.apply(window, &CursorChoice::Named(N::Default)),
        }
    }

    /// What the window shows with the surfaces' choice `surfaces`: the window manager's, else it.
    pub fn shown(&self, surfaces: Option<&CursorChoice>) -> Option<CursorChoice> {
        self.wm.map(CursorChoice::Named).or(surfaces.cloned())
    }

    fn apply(&self, window: &Window, choice: &CursorChoice) {
        match choice {
            CursorChoice::Named(name) => match icon(*name) {
                Some(icon) => {
                    window.set_cursor(icon);
                    window.set_cursor_visible(true);
                }
                None => window.set_cursor_visible(false),
            },
            CursorChoice::Image { png, .. } => match self.custom.get(png) {
                Some(cursor) => {
                    window.set_cursor(cursor.clone());
                    window.set_cursor_visible(true);
                }
                None => window.set_cursor(CursorIcon::Default),
            },
        }
    }
}

impl super::CompositorWindow {
    /// The window manager's cursor with the pointer at `at` (CSS pixels), none while the spread is
    /// open or the pointer is on the canvas map, which take the pointer first.
    pub(super) fn wm_cursor(&mut self, at: desk_wm::Point) {
        let device = self.spreading.at;
        let on_map = (self.mapping.drawn.as_ref())
            .zip(desk_compositor::hit_test(&self.scene, device))
            .is_some_and(|(map, hit)| map.nodes.contains(&hit.node));
        let wm = if self.spreading.open.is_some() || on_map {
            None
        } else {
            let now = self.hosted.ms(std::time::Instant::now());
            self.hosted.wm.cursor_at(at, now).and_then(named)
        };
        self.cursors.over(&self.window, wm);
    }
}

#[cfg(test)]
mod tests {
    use super::{icon, named, rgba_of};
    use desk_surface::generated::SurfaceCursorName as N;
    use winit::window::CursorIcon;

    #[test]
    fn the_window_managers_cursors_are_os_cursors() {
        for (css, want) in [
            ("ew-resize", CursorIcon::EwResize),
            ("ns-resize", CursorIcon::NsResize),
            ("nwse-resize", CursorIcon::NwseResize),
            ("nesw-resize", CursorIcon::NeswResize),
            ("grab", CursorIcon::Grab),
            ("grabbing", CursorIcon::Grabbing),
        ] {
            assert_eq!(named(css).and_then(icon), Some(want), "{css}");
        }
        assert_eq!(named("no such cursor"), None);
    }

    #[test]
    fn a_keyword_is_an_os_cursor_and_an_image_its_pixels() {
        assert_eq!(icon(N::Text), Some(CursorIcon::Text));
        assert_eq!(icon(N::None), None);
        let red_bgra = [0, 0, 255, 255].repeat(4);
        let png = crate::web_host::cursor::png_of(&red_bgra, 2, 2).unwrap();
        let (rgba, w, h) = rgba_of(&png).unwrap();
        assert_eq!((w, h), (2, 2));
        assert_eq!(&rgba[..4], &[255, 0, 0, 255], "red, as RGBA");
    }
}
