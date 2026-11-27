//! Bounded RGBA editing. The worker supplies decoded pixels and an ordered list of edit operations.

mod brush;
mod document;
mod filters;
mod geometry;
mod layers;
#[cfg(target_arch = "wasm32")]
mod wasm;

pub use brush::{Point, StrokeMode};
pub use document::Document;
use serde::Deserialize;

pub const MAX_PIXELS: usize = 16_000_000;
const MAX_DIMENSION: usize = 16_384;
pub const MAX_BATCH: usize = 16;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Image {
    width: usize,
    height: usize,
    pixels: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Operation {
    Crop {
        x: usize,
        y: usize,
        width: usize,
        height: usize,
    },
    Resize {
        width: usize,
        height: usize,
    },
    Rotate {
        degrees: u16,
    },
    Flip {
        axis: Axis,
    },
    Adjust {
        brightness: i32,
        contrast: i32,
        saturation: i32,
        layer: Option<u32>,
    },
    Invert {
        layer: Option<u32>,
    },
    Blur {
        radius: usize,
        layer: Option<u32>,
    },
    Sharpen {
        amount: usize,
        layer: Option<u32>,
    },
    AddLayer {
        name: String,
    },
    DuplicateLayer {
        layer: u32,
        name: Option<String>,
    },
    SetLayer {
        layer: u32,
        name: Option<String>,
        opacity: Option<u8>,
        visible: Option<bool>,
    },
    MoveLayer {
        layer: u32,
        index: usize,
    },
    RemoveLayer {
        layer: u32,
    },
    ResetMask {
        layer: u32,
    },
    Stroke {
        layer: u32,
        mode: StrokeMode,
        radius: u16,
        strength: u8,
        color: Option<[u8; 3]>,
        points: Vec<Point>,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Axis {
    Horizontal,
    Vertical,
}

impl Image {
    pub fn new(width: usize, height: usize, pixels: Vec<u8>) -> Result<Self, &'static str> {
        if pixels.len() != Self::byte_len(width, height)? {
            return Err("RGBA data does not match the image dimensions.");
        }
        Ok(Self {
            width,
            height,
            pixels,
        })
    }

    pub fn byte_len(width: usize, height: usize) -> Result<usize, &'static str> {
        if !(1..=MAX_DIMENSION).contains(&width)
            || !(1..=MAX_DIMENSION).contains(&height)
            || width * height > MAX_PIXELS
        {
            return Err("Use an image up to 16 megapixels and 16,384 pixels on each side.");
        }
        Ok(width * height * 4)
    }

    pub fn size(&self) -> (usize, usize) {
        (self.width, self.height)
    }

    pub fn pixels(&self) -> &[u8] {
        &self.pixels
    }

    fn transformed(&self, operation: &Operation) -> Result<Self, &'static str> {
        match *operation {
            Operation::Crop {
                x,
                y,
                width,
                height,
            } => self.crop(x, y, width, height),
            Operation::Resize { width, height } => self.resize(width, height),
            Operation::Rotate { degrees } => self.rotate(degrees),
            Operation::Flip { ref axis } => {
                let mut image = self.clone();
                image.flip(axis);
                Ok(image)
            }
            _ => unreachable!("only canvas geometry operations reach this method"),
        }
    }

    pub fn png(&self) -> Result<Vec<u8>, png::EncodingError> {
        let mut bytes = Vec::new();
        let mut encoder = png::Encoder::new(&mut bytes, self.width as u32, self.height as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_source_srgb(png::SrgbRenderingIntent::Perceptual);
        encoder.set_compression(png::Compression::Fast);
        let mut writer = encoder.write_header()?;
        writer.write_image_data(&self.pixels)?;
        writer.finish()?;
        Ok(bytes)
    }
}
