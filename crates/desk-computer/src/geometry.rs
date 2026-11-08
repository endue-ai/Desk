//! Points and rectangles in global display points: the origin is the top left of the main display,
//! y grows down, and other displays have negative or larger coordinates.

use std::fmt;

/// A point in global display points.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

impl Point {
    pub fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    /// Whether both coordinates are finite numbers.
    pub fn is_finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite()
    }

    /// The point `t` of the way from `self` to `to` (0 is `self`, 1 is `to`).
    pub fn lerp(self, to: Point, t: f64) -> Point {
        Point::new(self.x + (to.x - self.x) * t, self.y + (to.y - self.y) * t)
    }

    pub fn distance(self, to: Point) -> f64 {
        (to.x - self.x).hypot(to.y - self.y)
    }
}

impl fmt::Display for Point {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "({}, {})", self.x, self.y)
    }
}

/// A rectangle in global display points; `x` and `y` are its top left corner.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    pub fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    pub fn origin(self) -> Point {
        Point::new(self.x, self.y)
    }

    pub fn center(self) -> Point {
        Point::new(self.x + self.width / 2.0, self.y + self.height / 2.0)
    }

    /// Whether `point` is inside; the right and bottom edges are outside.
    pub fn contains(self, point: Point) -> bool {
        point.x >= self.x
            && point.y >= self.y
            && point.x < self.x + self.width
            && point.y < self.y + self.height
    }

    /// The area both rectangles cover, zero when they do not meet.
    pub fn overlap(self, other: Rect) -> f64 {
        let width = (self.x + self.width).min(other.x + other.width) - self.x.max(other.x);
        let height = (self.y + self.height).min(other.y + other.height) - self.y.max(other.y);
        width.max(0.0) * height.max(0.0)
    }

    /// Finite, with a positive width and height.
    pub fn is_usable(self) -> bool {
        self.origin().is_finite()
            && self.width.is_finite()
            && self.height.is_finite()
            && self.width > 0.0
            && self.height > 0.0
    }
}

impl fmt::Display for Rect {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "({}, {}) {}×{}", self.x, self.y, self.width, self.height)
    }
}
