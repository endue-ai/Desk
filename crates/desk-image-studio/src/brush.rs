use serde::Deserialize;

use super::Image;

#[derive(Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Point {
    pub x: u16,
    pub y: u16,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StrokeMode {
    Paint,
    Erase,
    MaskHide,
    MaskReveal,
}

impl StrokeMode {
    pub(crate) fn is_mask(self) -> bool {
        matches!(self, Self::MaskHide | Self::MaskReveal)
    }
}

pub(crate) struct Stroke {
    coverage: Coverage,
    strength: u8,
    mode: StrokeMode,
    color: [u8; 3],
}

impl Stroke {
    pub(crate) fn new(
        width: usize,
        height: usize,
        points: &[Point],
        radius: u16,
        strength: u8,
        mode: StrokeMode,
        color: Option<[u8; 3]>,
    ) -> Result<Self, &'static str> {
        if !(1..=128).contains(&points.len())
            || points
                .iter()
                .any(|p| usize::from(p.x) >= width || usize::from(p.y) >= height)
        {
            return Err("Use 1 to 128 brush points inside the canvas.");
        }
        if !(1..=256).contains(&radius) || !(1..=100).contains(&strength) {
            return Err("Use a radius from 1 to 256 pixels and a strength from 1 to 100 percent.");
        }
        if matches!(mode, StrokeMode::Paint) && color.is_none() {
            return Err("Choose an RGB brush color.");
        }
        let mut coverage = Coverage::new(width, height, points, radius);
        let radius = f64::from(radius);
        for &point in points {
            coverage.disk(point, radius);
        }
        for segment in points.windows(2) {
            coverage.segment(segment[0], segment[1], radius);
        }
        Ok(Self {
            coverage,
            strength: ((u16::from(strength) * 255 + 50) / 100) as u8,
            mode,
            color: color.unwrap_or_default(),
        })
    }

    pub(crate) fn apply(&self, image: &mut Image) {
        let cover = &self.coverage;
        for (row, mask) in cover.values.chunks_exact(cover.width).enumerate() {
            let start = (image.width * (cover.y + row) + cover.x) * 4;
            let pixels = image.pixels[start..start + cover.width * 4]
                .as_chunks_mut::<4>()
                .0;
            for (pixel, &covered) in pixels.iter_mut().zip(mask) {
                if covered == 0 {
                    continue;
                }
                match self.mode {
                    StrokeMode::Paint => over(pixel, self.color, self.strength),
                    StrokeMode::Erase => {
                        pixel[3] = scale_alpha(pixel[3], 255 - self.strength);
                        if pixel[3] == 0 {
                            *pixel = [0; 4];
                        }
                    }
                    StrokeMode::MaskHide => pixel[3] = scale_alpha(pixel[3], 255 - self.strength),
                    StrokeMode::MaskReveal => {
                        pixel[3] += scale_alpha(255 - pixel[3], self.strength)
                    }
                }
            }
        }
    }
}

pub(crate) fn scale_alpha(value: u8, factor: u8) -> u8 {
    ((u16::from(value) * u16::from(factor) + 127) / 255) as u8
}

/// Straight-alpha source-over. A brush stroke covers every pixel once, including overlaps.
pub(crate) fn over(dst: &mut [u8; 4], rgb: [u8; 3], alpha: u8) {
    if alpha == 0 {
        return;
    }
    if alpha == 255 || dst[3] == 0 {
        *dst = [rgb[0], rgb[1], rgb[2], alpha];
        return;
    }
    let src = u32::from(alpha) * 255;
    let old = u32::from(dst[3]) * u32::from(255 - alpha);
    let total = src + old;
    for channel in 0..3 {
        dst[channel] = ((u32::from(rgb[channel]) * src + u32::from(dst[channel]) * old + total / 2)
            / total) as u8;
    }
    dst[3] = ((total + 127) / 255) as u8;
}

/// The union of the endpoint disks and the rectangle between each pair, filled as scanlines.
struct Coverage {
    x: usize,
    y: usize,
    width: usize,
    height: usize,
    values: Vec<u8>,
}

impl Coverage {
    fn new(width: usize, height: usize, points: &[Point], radius: u16) -> Self {
        let bounds = |coordinate: fn(&Point) -> u16, edge: usize| {
            let low = usize::from(
                points
                    .iter()
                    .map(coordinate)
                    .min()
                    .unwrap_or(0)
                    .saturating_sub(radius),
            );
            let high =
                usize::from(points.iter().map(coordinate).max().unwrap_or(0)) + usize::from(radius);
            (low, high.min(edge - 1) - low + 1)
        };
        let (x, width) = bounds(|point| point.x, width);
        let (y, height) = bounds(|point| point.y, height);
        Self {
            x,
            y,
            width,
            height,
            values: vec![0; width * height],
        }
    }

    fn span(&mut self, y: usize, left: f64, right: f64) {
        let edge = self.x + self.width - 1;
        if right < self.x as f64 || left > edge as f64 {
            return;
        }
        let left = (left.ceil() as usize).max(self.x);
        let right = (right.floor() as usize).min(edge);
        if left <= right {
            let row = (y - self.y) * self.width;
            self.values[row + left - self.x..=row + right - self.x].fill(1);
        }
    }

    fn rows(&self, low: f64, high: f64) -> std::ops::RangeInclusive<usize> {
        (low.ceil() as usize).max(self.y)..=(high.floor() as usize).min(self.y + self.height - 1)
    }

    fn disk(&mut self, point: Point, radius: f64) {
        let (x, cy) = (f64::from(point.x), f64::from(point.y));
        for y in self.rows(cy - radius, cy + radius) {
            let dy = y as f64 - cy;
            let extent = (radius * radius - dy * dy).sqrt();
            self.span(y, x - extent, x + extent);
        }
    }

    fn segment(&mut self, a: Point, b: Point, radius: f64) {
        let (ax, ay) = (f64::from(a.x), f64::from(a.y));
        let (bx, by) = (f64::from(b.x), f64::from(b.y));
        let (dx, dy) = (bx - ax, by - ay);
        let length = dx.hypot(dy);
        if length == 0.0 {
            return;
        }
        let (nx, ny) = (-dy * radius / length, dx * radius / length);
        let corners = [
            (ax + nx, ay + ny),
            (bx + nx, by + ny),
            (bx - nx, by - ny),
            (ax - nx, ay - ny),
        ];
        for y in self.rows(ay.min(by) - ny.abs(), ay.max(by) + ny.abs()) {
            let mut left = f64::INFINITY;
            let mut right = f64::NEG_INFINITY;
            for ((x1, y1), (x2, y2)) in corners.into_iter().zip(corners.into_iter().cycle().skip(1))
            {
                let row = y as f64;
                if row < y1.min(y2) || row > y1.max(y2) {
                    continue;
                }
                if y1 == y2 {
                    left = left.min(x1.min(x2));
                    right = right.max(x1.max(x2));
                } else {
                    let x = x1 + (x2 - x1) * (row - y1) / (y2 - y1);
                    left = left.min(x);
                    right = right.max(x);
                }
            }
            self.span(y, left, right);
        }
    }
}
