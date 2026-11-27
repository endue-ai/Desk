use super::{Axis, Image};

impl Image {
    pub(crate) fn crop(
        &self,
        x: usize,
        y: usize,
        width: usize,
        height: usize,
    ) -> Result<Self, &'static str> {
        let length = Self::byte_len(width, height)?;
        if x > self.width.saturating_sub(width)
            || y > self.height.saturating_sub(height)
            || width > self.width
            || height > self.height
        {
            return Err("The crop must fit inside the current image.");
        }
        let mut pixels = Vec::with_capacity(length);
        for row in y..y + height {
            let start = (row * self.width + x) * 4;
            pixels.extend_from_slice(&self.pixels[start..start + width * 4]);
        }
        Self::new(width, height, pixels)
    }

    pub(crate) fn rotate(&self, degrees: u16) -> Result<Self, &'static str> {
        let (width, height) = match degrees {
            90 | 270 => (self.height, self.width),
            180 => (self.width, self.height),
            _ => return Err("Choose a rotation of 90, 180 or 270 degrees."),
        };
        let mut pixels = vec![0; self.pixels.len()];
        for y in 0..height {
            for x in 0..width {
                let (sx, sy) = match degrees {
                    90 => (y, self.height - 1 - x),
                    180 => (self.width - 1 - x, self.height - 1 - y),
                    _ => (self.width - 1 - y, x),
                };
                let to = (y * width + x) * 4;
                let from = (sy * self.width + sx) * 4;
                pixels[to..to + 4].copy_from_slice(&self.pixels[from..from + 4]);
            }
        }
        Self::new(width, height, pixels)
    }

    pub(crate) fn flip(&mut self, axis: &Axis) {
        match axis {
            Axis::Horizontal => {
                for row in self.pixels.chunks_exact_mut(self.width * 4) {
                    for x in 0..self.width / 2 {
                        let opposite = self.width - 1 - x;
                        for channel in 0..4 {
                            row.swap(x * 4 + channel, opposite * 4 + channel);
                        }
                    }
                }
            }
            Axis::Vertical => {
                let stride = self.width * 4;
                for y in 0..self.height / 2 {
                    let (head, tail) = self.pixels.split_at_mut((self.height - 1 - y) * stride);
                    head[y * stride..(y + 1) * stride].swap_with_slice(&mut tail[..stride]);
                }
            }
        }
    }

    pub fn resize(&self, width: usize, height: usize) -> Result<Self, &'static str> {
        let length = Self::byte_len(width, height)?;
        if self.size() == (width, height) {
            return Ok(self.clone());
        }
        let columns = samples(self.width, width);
        let rows = samples(self.height, height);
        let mut pixels = Vec::with_capacity(length);
        for (top, bottom, v) in rows {
            for &(left, right, u) in &columns {
                let samples = [
                    (top, left, (1.0 - u) * (1.0 - v)),
                    (top, right, u * (1.0 - v)),
                    (bottom, left, (1.0 - u) * v),
                    (bottom, right, u * v),
                ];
                let mut rgb = [0.0; 3];
                let mut alpha = 0.0;
                for (y, x, weight) in samples {
                    let start = (y * self.width + x) * 4;
                    let pixel = &self.pixels[start..start + 4];
                    let a = f32::from(pixel[3]) * weight;
                    alpha += a;
                    for channel in 0..3 {
                        rgb[channel] += f32::from(pixel[channel]) * a;
                    }
                }
                pixels.extend(rgb.map(|channel| {
                    if alpha > 0.0 {
                        (channel / alpha).round() as u8
                    } else {
                        0
                    }
                }));
                pixels.push(alpha.round() as u8);
            }
        }
        Self::new(width, height, pixels)
    }
}

fn samples(source: usize, target: usize) -> Vec<(usize, usize, f32)> {
    let scale = source as f32 / target as f32;
    (0..target)
        .map(|index| {
            let position = ((index as f32 + 0.5) * scale - 0.5).clamp(0.0, (source - 1) as f32);
            let start = position as usize;
            (start, (start + 1).min(source - 1), position - start as f32)
        })
        .collect()
}
