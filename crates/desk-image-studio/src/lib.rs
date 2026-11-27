//! Bounded RGBA editing. The worker supplies decoded pixels and an ordered list of edit operations.

mod filters;
mod geometry;
#[cfg(target_arch = "wasm32")]
mod wasm;

use std::collections::VecDeque;

use serde::{Deserialize, Serialize};

pub const MAX_PIXELS: usize = 16_000_000;
const MAX_DIMENSION: usize = 16_384;
const HISTORY_BYTES: usize = 128 * 1024 * 1024;
const HISTORY_STEPS: usize = 12;
pub const MAX_BATCH: usize = 16;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Image {
    width: usize,
    height: usize,
    pixels: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "lowercase", deny_unknown_fields)]
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
    },
    Invert,
    Blur {
        radius: usize,
    },
    Sharpen {
        amount: usize,
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

    fn apply(&mut self, operation: &Operation) -> Result<(), &'static str> {
        match *operation {
            Operation::Crop {
                x,
                y,
                width,
                height,
            } => *self = self.crop(x, y, width, height)?,
            Operation::Resize { width, height } => *self = self.resize(width, height)?,
            Operation::Rotate { degrees } => *self = self.rotate(degrees)?,
            Operation::Flip { ref axis } => self.flip(axis),
            Operation::Adjust {
                brightness,
                contrast,
                saturation,
            } => self.adjust(brightness, contrast, saturation)?,
            Operation::Invert => self.invert(),
            Operation::Blur { radius } => self.blur(radius)?,
            Operation::Sharpen { amount } => self.sharpen(amount)?,
        }
        Ok(())
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

pub struct Document {
    image: Image,
    past: VecDeque<Image>,
    future: Vec<Image>,
    history_bytes: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Details {
    width: usize,
    height: usize,
    can_undo: bool,
    can_redo: bool,
}

impl Document {
    pub fn new(image: Image) -> Self {
        Self {
            image,
            past: VecDeque::new(),
            future: Vec::new(),
            history_bytes: 0,
        }
    }

    pub fn image(&self) -> &Image {
        &self.image
    }

    pub fn details(&self) -> Details {
        Details {
            width: self.image.width,
            height: self.image.height,
            can_undo: !self.past.is_empty(),
            can_redo: !self.future.is_empty(),
        }
    }

    pub fn apply(&mut self, operations: &[Operation]) -> Result<(), &'static str> {
        if !(1..=MAX_BATCH).contains(&operations.len()) {
            return Err("Apply one to sixteen operations in a batch.");
        }
        let mut image = self.image.clone();
        for operation in operations {
            image.apply(operation)?;
        }
        let previous = std::mem::replace(&mut self.image, image);
        self.future.clear();
        self.history_bytes += previous.pixels.len();
        self.past.push_back(previous);
        while self.history_bytes > HISTORY_BYTES || self.past.len() > HISTORY_STEPS {
            if let Some(oldest) = self.past.pop_front() {
                self.history_bytes -= oldest.pixels.len();
            }
        }
        Ok(())
    }

    pub fn undo(&mut self) -> Result<(), &'static str> {
        let previous = self
            .past
            .pop_back()
            .ok_or("There are no earlier edits to undo.")?;
        self.history_bytes -= previous.pixels.len();
        self.future
            .push(std::mem::replace(&mut self.image, previous));
        Ok(())
    }

    pub fn redo(&mut self) -> Result<(), &'static str> {
        let next = self
            .future
            .pop()
            .ok_or("There are no later edits to redo.")?;
        let previous = std::mem::replace(&mut self.image, next);
        self.history_bytes += previous.pixels.len();
        self.past.push_back(previous);
        Ok(())
    }
}
