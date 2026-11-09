//! Plain value types the scene is made of: rectangles, colours, strokes, shadows and texture ids.

use glam::Vec2;

/// An axis-aligned rectangle: top-left corner and size, in the units of the space it lives in
/// (pixels for the screen, the parent group's units for a node).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

impl Rect {
    /// The unit square, the whole of a texture as a uv rectangle.
    pub const UNIT: Rect = Rect::new(0.0, 0.0, 1.0, 1.0);

    pub const fn new(x: f32, y: f32, width: f32, height: f32) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    /// The rectangle between two corners, in any order.
    pub fn from_corners(a: Vec2, b: Vec2) -> Rect {
        let (min, max) = (a.min(b), a.max(b));
        Rect::new(min.x, min.y, max.x - min.x, max.y - min.y)
    }

    pub fn min(&self) -> Vec2 {
        Vec2::new(self.x, self.y)
    }

    pub fn max(&self) -> Vec2 {
        Vec2::new(self.x + self.width, self.y + self.height)
    }

    pub fn is_empty(&self) -> bool {
        self.width <= 0.0 || self.height <= 0.0
    }

    /// Whether `point` lies inside; the top and left edges are in, the bottom and right edges out.
    pub fn contains(&self, point: Vec2) -> bool {
        point.x >= self.x
            && point.y >= self.y
            && point.x < self.x + self.width
            && point.y < self.y + self.height
    }

    /// The smallest rectangle holding both (an empty one adds nothing).
    pub fn union(&self, other: &Rect) -> Rect {
        if self.is_empty() {
            return *other;
        }
        if other.is_empty() {
            return *self;
        }
        Rect::from_corners(self.min().min(other.min()), self.max().max(other.max()))
    }

    /// The overlap of both, `None` when they do not overlap.
    pub fn intersect(&self, other: &Rect) -> Option<Rect> {
        let (min, max) = (self.min().max(other.min()), self.max().min(other.max()));
        (max.x > min.x && max.y > min.y).then(|| Rect::from_corners(min, max))
    }

    /// Grown by `amount` on every side (shrunk when negative).
    pub fn inflate(&self, amount: f32) -> Rect {
        Rect::new(
            self.x - amount,
            self.y - amount,
            self.width + 2.0 * amount,
            self.height + 2.0 * amount,
        )
    }

    pub fn translate(&self, offset: Vec2) -> Rect {
        Rect::new(
            self.x + offset.x,
            self.y + offset.y,
            self.width,
            self.height,
        )
    }

    /// Rounded out to whole pixels; edges within a thousandth of a pixel of a whole one snap to it
    /// (projection leaves 10.0 as 9.99999).
    pub fn round_out(&self) -> Rect {
        const SNAP: f32 = 1e-3;
        Rect::from_corners((self.min() + SNAP).floor(), (self.max() - SNAP).ceil())
    }
}

/// A colour with straight (not premultiplied) alpha, each channel 0..1, in the target's encoding:
/// render into a non-sRGB format (as browsers blend) and these are the values written.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Color {
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
}

impl Color {
    pub const TRANSPARENT: Color = Color::new(0.0, 0.0, 0.0, 0.0);
    pub const BLACK: Color = Color::new(0.0, 0.0, 0.0, 1.0);
    pub const WHITE: Color = Color::new(1.0, 1.0, 1.0, 1.0);

    pub const fn new(r: f32, g: f32, b: f32, a: f32) -> Color {
        Color { r, g, b, a }
    }

    /// From 8-bit channels.
    pub fn rgba8(r: u8, g: u8, b: u8, a: u8) -> Color {
        let c = |v: u8| f32::from(v) / 255.0;
        Color::new(c(r), c(g), c(b), c(a))
    }

    /// From `0xRRGGBB`, opaque.
    pub fn hex(rgb: u32) -> Color {
        let [_, r, g, b] = rgb.to_be_bytes();
        Color::rgba8(r, g, b, 255)
    }

    /// The same colour with alpha multiplied by `factor`.
    pub fn fade(self, factor: f32) -> Color {
        Color {
            a: self.a * factor,
            ..self
        }
    }

    pub(crate) fn to_array(self) -> [f32; 4] {
        [self.r, self.g, self.b, self.a]
    }
}

/// A border drawn inside the rectangle's edge, as CSS draws one.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Stroke {
    pub width: f32,
    pub color: Color,
}

/// An outer drop shadow, as CSS `box-shadow` describes one (`blur` is the blur radius, twice the
/// Gaussian's sigma). It is drawn whole under the rectangle; a translucent fill shows it through.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Shadow {
    pub offset: Vec2,
    pub blur: f32,
    pub spread: f32,
    pub color: Color,
}

impl Shadow {
    /// The area the shadow paints, around the shape `rect`.
    pub(crate) fn bounds(&self, rect: &Rect) -> Rect {
        rect.translate(self.offset)
            .inflate(self.spread + self.blur * 1.5)
    }
}

/// The union of two optional regions.
pub(crate) fn union(a: Option<Rect>, b: Option<Rect>) -> Option<Rect> {
    match (a, b) {
        (Some(a), Some(b)) => Some(a.union(&b)),
        (a, b) => a.or(b),
    }
}

/// The caller's name for a texture registered with the compositor (for example a surface id).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct TextureId(pub u64);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rect_union_intersect_and_contains() {
        let a = Rect::new(0.0, 0.0, 10.0, 10.0);
        let b = Rect::new(5.0, 5.0, 10.0, 10.0);
        assert_eq!(a.union(&b), Rect::new(0.0, 0.0, 15.0, 15.0));
        assert_eq!(a.intersect(&b), Some(Rect::new(5.0, 5.0, 5.0, 5.0)));
        assert_eq!(a.intersect(&Rect::new(20.0, 0.0, 1.0, 1.0)), None);
        assert_eq!(Rect::default().union(&a), a);
        assert!(a.contains(Vec2::new(0.0, 9.99)));
        assert!(!a.contains(Vec2::new(10.0, 5.0)));
        assert_eq!(
            Rect::new(0.4, 0.6, 1.0, 1.0).round_out(),
            Rect::new(0.0, 0.0, 2.0, 2.0)
        );
    }

    #[test]
    fn colours_from_bytes_and_hex() {
        assert_eq!(Color::hex(0xff0000), Color::new(1.0, 0.0, 0.0, 1.0));
        assert_eq!(Color::rgba8(0, 0, 0, 0), Color::TRANSPARENT);
        assert_eq!(Color::WHITE.fade(0.5).a, 0.5);
    }
}
