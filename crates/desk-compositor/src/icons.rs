//! Line icons drawn into textures (the canvas map's windows, ADR 0273): SVG path data on a 24-unit
//! grid, stroked 2 units wide with round caps and joins as the runtime's `shell/icons.ts` draws
//! them, in one colour, into a square of device pixels. They are rasterized on the CPU (zeno, the
//! rasterizer text's glyphs already use) and uploaded once; an icon is a texture the compositor
//! holds under an id of its own range ([`ICON_IDS`]), kept while its caller asks for it between
//! two sweeps.

use std::collections::HashMap;

use zeno::{Cap, Join, Mask, Stroke, Transform};

use crate::compositor::Compositor;
use crate::headless::upload_rgba;
use crate::types::{Color, TextureId};

/// Where icons' texture ids start: callers name textures from 1 up, far below, and thumbnails
/// start above (`THUMBNAIL_IDS`).
pub const ICON_IDS: u64 = 1 << 47;
/// The grid an icon's path is drawn on, and its stroke there.
const GRID: f32 = 24.0;
const STROKE: f32 = 2.0;
/// The largest icon drawn, in device pixels on a side.
const MOST: u32 = 512;

/// `path` (SVG path data on the 24 grid) stroked in `color` into a `px` square, as tightly packed
/// RGBA rows with premultiplied alpha; `None` for no size, too large a one, or a path that draws
/// nothing there.
pub fn rasterize(path: &str, px: u32, color: Color) -> Option<Vec<u8>> {
    if px == 0 || px > MOST || path.trim().is_empty() {
        return None;
    }
    let k = px as f32 / GRID;
    let mut stroke = Stroke::new(STROKE);
    stroke.cap(Cap::Round).join(Join::Round);
    let mut mask = vec![0u8; (px * px) as usize];
    Mask::new(path)
        .style(stroke)
        .transform(Some(Transform::scale(k, k)))
        .size(px, px)
        .render_into(&mut mask, None);
    if mask.iter().all(|coverage| *coverage == 0) {
        return None;
    }
    let channel = |c: f32, a: f32| (c * a * 255.0).round().clamp(0.0, 255.0) as u8;
    let rgba = (mask.iter())
        .flat_map(|coverage| {
            let a = color.a * f32::from(*coverage) / 255.0;
            let c = |v: f32| channel(v, a);
            [c(color.r), c(color.g), c(color.b), channel(1.0, a)]
        })
        .collect();
    Some(rgba)
}

/// What an icon draws: its path, its size and its colour.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct Key {
    path: String,
    px: u32,
    rgba: [u8; 4],
}

/// One icon made: its texture (none for a path that draws nothing) and whether it was asked for
/// since the last sweep.
struct Held {
    id: Option<TextureId>,
    asked: bool,
}

/// The icons one compositor holds, by what they draw.
#[derive(Default)]
pub struct Icons {
    held: HashMap<Key, Held>,
    next: u64,
}

impl Icons {
    pub fn new() -> Icons {
        Icons::default()
    }

    /// The texture of `path` stroked in `color` into a `px` square, registered with `compositor`
    /// (made now if it was not); `None` when it draws nothing.
    pub fn icon(
        &mut self,
        compositor: &mut Compositor,
        path: &str,
        px: u32,
        color: Color,
    ) -> Option<TextureId> {
        let byte = |v: f32| (v * 255.0).round().clamp(0.0, 255.0) as u8;
        let key = Key {
            path: path.to_owned(),
            px,
            rgba: [byte(color.r), byte(color.g), byte(color.b), byte(color.a)],
        };
        if let Some(held) = self.held.get_mut(&key) {
            held.asked = true;
            return held.id;
        }
        let id = rasterize(path, px, color).map(|rgba| {
            self.next += 1;
            let id = TextureId(ICON_IDS + self.next);
            let texture = upload_rgba(compositor.device(), compositor.queue(), (px, px), &rgba);
            compositor.register_texture(id, &texture);
            id
        });
        self.held.insert(key, Held { id, asked: true });
        id
    }

    /// Let go of every icon not asked for since the last sweep, its texture with it.
    pub fn sweep(&mut self, compositor: &mut Compositor) {
        self.held.retain(|_, held| {
            let keep = std::mem::take(&mut held.asked);
            if !keep && let Some(id) = held.id {
                compositor.remove_texture(id);
            }
            keep
        });
    }

    /// How many icons it holds, drawn or not.
    pub fn len(&self) -> usize {
        self.held.len()
    }

    pub fn is_empty(&self) -> bool {
        self.held.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::rasterize;
    use crate::types::Color;

    /// The alpha of `rgba`'s pixel at `x`, `y` in a `px` square.
    fn alpha(rgba: &[u8], px: u32, x: u32, y: u32) -> u8 {
        rgba[((y * px + x) * 4 + 3) as usize]
    }

    #[test]
    fn a_line_is_stroked_two_grid_units_wide_with_round_caps_at_the_squares_scale() {
        // A line across the middle of the grid, drawn 48 px: the stroke is 4 px wide there.
        let rgba = rasterize("M4 12h16", 48, Color::WHITE).unwrap();
        assert_eq!(rgba.len(), 48 * 48 * 4);
        let column: Vec<u8> = (0..48).map(|y| alpha(&rgba, 48, 24, y)).collect();
        let solid = column.iter().filter(|a| **a == 255).count();
        assert_eq!(solid, 4, "{column:?}");
        assert_eq!(alpha(&rgba, 48, 24, 10), 0, "above it");
        // A round cap reaches a unit past the line's end, 2 px at this scale.
        assert!(alpha(&rgba, 48, 6, 24) > 0, "the cap");
        assert_eq!(alpha(&rgba, 48, 4, 24), 0, "past the cap");
    }

    #[test]
    fn its_colour_is_premultiplied_by_coverage() {
        let ink = Color::new(0.5, 0.25, 1.0, 0.5);
        let rgba = rasterize("M4 12h16", 24, ink).unwrap();
        let at = ((12 * 24 + 12) * 4) as usize;
        let solid = &rgba[at..at + 4];
        assert_eq!(solid, [64, 32, 128, 128]);
        for px in rgba.chunks(4) {
            assert!(px[0] <= px[3] && px[2] <= px[3], "premultiplied: {px:?}");
        }
    }

    #[test]
    fn no_size_no_path_or_a_path_off_the_grid_draws_nothing() {
        assert_eq!(rasterize("M4 12h16", 0, Color::WHITE), None);
        assert_eq!(rasterize("M4 12h16", 4096, Color::WHITE), None);
        assert_eq!(rasterize("  ", 24, Color::WHITE), None);
        assert_eq!(rasterize("M100 100h10", 24, Color::WHITE), None);
    }
}
