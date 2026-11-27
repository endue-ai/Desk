use std::sync::Arc;

use serde::Serialize;

use super::{
    Image, Operation,
    brush::{Stroke, over, scale_alpha},
};

const LAYER_LIMIT: usize = 8;
const CANVAS_BYTES: usize = 192 * 1024 * 1024;

#[derive(Clone)]
struct Layer {
    id: u32,
    name: String,
    opacity: u8,
    visible: bool,
    image: Option<Arc<Image>>,
    mask: Option<Arc<Image>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LayerInfo<'a> {
    id: u32,
    name: &'a str,
    opacity: u8,
    visible: bool,
    has_mask: bool,
}

#[derive(Clone)]
pub(crate) struct Canvas {
    width: usize,
    height: usize,
    layers: Vec<Layer>,
    next_id: u32,
}

impl Canvas {
    pub(crate) fn new(image: Arc<Image>) -> Self {
        let (width, height) = image.size();
        Self {
            width,
            height,
            layers: vec![Layer {
                id: 1,
                name: "Background".into(),
                opacity: 100,
                visible: true,
                image: Some(image),
                mask: None,
            }],
            next_id: 2,
        }
    }

    pub(crate) fn buffers(&self) -> impl Iterator<Item = &Arc<Image>> {
        self.layers
            .iter()
            .flat_map(|layer| layer.image.iter().chain(layer.mask.iter()))
    }

    pub(crate) fn layer_info(&self) -> Vec<LayerInfo<'_>> {
        self.layers
            .iter()
            .map(|layer| LayerInfo {
                id: layer.id,
                name: &layer.name,
                opacity: layer.opacity,
                visible: layer.visible,
                has_mask: layer.mask.is_some(),
            })
            .collect()
    }

    pub(crate) fn apply(&mut self, operation: &Operation) -> Result<(), &'static str> {
        match operation {
            Operation::Crop { .. }
            | Operation::Resize { .. }
            | Operation::Rotate { .. }
            | Operation::Flip { .. } => self.geometry(operation)?,
            Operation::AddLayer { name } => {
                let id = self.layer_id()?;
                self.layers.push(Layer {
                    id,
                    name: layer_name(name)?,
                    opacity: 100,
                    visible: true,
                    image: None,
                    mask: None,
                });
            }
            Operation::DuplicateLayer { layer, name } => {
                let index = self.index(*layer)?;
                self.check_size(
                    self.width,
                    self.height,
                    self.buffers().count()
                        + usize::from(self.layers[index].image.is_some())
                        + usize::from(self.layers[index].mask.is_some()),
                )?;
                let id = self.layer_id()?;
                let mut copy = self.layers[index].clone();
                copy.name = match name {
                    Some(name) => layer_name(name)?,
                    None => format!("{} copy", copy.name.chars().take(75).collect::<String>()),
                };
                copy.id = id;
                self.layers.insert(index + 1, copy);
            }
            Operation::SetLayer {
                layer,
                name,
                opacity,
                visible,
            } => {
                let index = self.index(*layer)?;
                let layer = &mut self.layers[index];
                if let Some(name) = name {
                    layer.name = layer_name(name)?;
                }
                if let Some(opacity) = opacity {
                    if *opacity > 100 {
                        return Err("Use a layer opacity from 0 to 100 percent.");
                    }
                    layer.opacity = *opacity;
                }
                if let Some(visible) = visible {
                    layer.visible = *visible;
                }
            }
            Operation::MoveLayer { layer, index } => {
                let from = self.index(*layer)?;
                if *index >= self.layers.len() {
                    return Err("The layer position is outside the stack.");
                }
                let layer = self.layers.remove(from);
                self.layers.insert(*index, layer);
            }
            Operation::RemoveLayer { layer } => {
                let index = self.index(*layer)?;
                if self.layers.len() == 1 {
                    return Err("Keep at least one layer in the image.");
                }
                self.layers.remove(index);
            }
            Operation::ResetMask { layer } => {
                let index = self.index(*layer)?;
                self.layers[index].mask = None;
            }
            Operation::Stroke {
                layer,
                mode,
                radius,
                strength,
                color,
                points,
            } => {
                let index = self.index(*layer)?;
                let is_mask = mode.is_mask();
                let missing = if is_mask {
                    self.layers[index].mask.is_none()
                } else {
                    self.layers[index].image.is_none()
                };
                self.check_size(
                    self.width,
                    self.height,
                    self.buffers().count() + usize::from(missing),
                )?;
                let stroke = Stroke::new(
                    self.width,
                    self.height,
                    points,
                    *radius,
                    *strength,
                    *mode,
                    *color,
                )?;
                let target = if is_mask {
                    &mut self.layers[index].mask
                } else {
                    &mut self.layers[index].image
                };
                let image = target.get_or_insert_with(|| {
                    Arc::new(blank(
                        self.width,
                        self.height,
                        if is_mask { 255 } else { 0 },
                    ))
                });
                stroke.apply(Arc::make_mut(image));
            }
            Operation::Adjust {
                layer,
                brightness,
                contrast,
                saturation,
            } => {
                if [brightness, contrast, saturation]
                    .into_iter()
                    .any(|value| !(-100..=100).contains(value))
                {
                    return Err("Use adjustment values between -100 and 100.");
                }
                self.filter(*layer, |image| {
                    image.adjust(*brightness, *contrast, *saturation)
                })?;
            }
            Operation::Invert { layer } => self.filter(*layer, |image| {
                image.invert();
                Ok(())
            })?,
            Operation::Blur { layer, radius } => {
                if !(1..=32).contains(radius) {
                    return Err("Use a blur radius from 1 to 32 pixels.");
                }
                self.filter(*layer, |image| image.blur(*radius))?;
            }
            Operation::Sharpen { layer, amount } => {
                if !(1..=100).contains(amount) {
                    return Err("Use a sharpen amount from 1 to 100.");
                }
                self.filter(*layer, |image| image.sharpen(*amount))?;
            }
        }
        Ok(())
    }

    pub(crate) fn composite(&self) -> Arc<Image> {
        let mut visible = self
            .layers
            .iter()
            .filter(|layer| layer.visible && layer.opacity > 0)
            .filter_map(|layer| layer.image.as_ref().map(|image| (layer, image)));
        let Some(first) = visible.next() else {
            return Arc::new(blank(self.width, self.height, 0));
        };
        let second = visible.next();
        let start_with_first = first.0.opacity == 100 && first.0.mask.is_none();
        if second.is_none() && start_with_first {
            return Arc::clone(first.1);
        }
        let mut output = if start_with_first {
            Image::clone(first.1)
        } else {
            blank(self.width, self.height, 0)
        };
        for (layer, image) in (!start_with_first)
            .then_some(first)
            .into_iter()
            .chain(second)
            .chain(visible)
        {
            let opacity = ((u16::from(layer.opacity) * 255 + 50) / 100) as u8;
            for (index, (dst, src)) in output
                .pixels
                .as_chunks_mut::<4>()
                .0
                .iter_mut()
                .zip(image.pixels.as_chunks::<4>().0)
                .enumerate()
            {
                if src[3] == 0 {
                    continue;
                }
                let mask = layer
                    .mask
                    .as_ref()
                    .map_or(255, |mask| mask.pixels[index * 4 + 3]);
                over(
                    dst,
                    [src[0], src[1], src[2]],
                    scale_alpha(scale_alpha(src[3], mask), opacity),
                );
            }
        }
        Arc::new(output)
    }

    fn layer_id(&mut self) -> Result<u32, &'static str> {
        if self.layers.len() >= LAYER_LIMIT {
            return Err("An image can have up to eight layers.");
        }
        let id = self.next_id;
        self.next_id += 1;
        Ok(id)
    }

    fn index(&self, layer: u32) -> Result<usize, &'static str> {
        self.layers
            .iter()
            .position(|entry| entry.id == layer)
            .ok_or("That layer is no longer in the image.")
    }

    fn check_size(
        &self,
        width: usize,
        height: usize,
        buffer_count: usize,
    ) -> Result<(), &'static str> {
        if Image::byte_len(width, height)? * buffer_count > CANVAS_BYTES {
            return Err("This layer stack exceeds 192 MiB. Resize the canvas or remove a layer.");
        }
        Ok(())
    }

    fn filter(
        &mut self,
        layer: Option<u32>,
        mut edit: impl FnMut(&mut Image) -> Result<(), &'static str>,
    ) -> Result<(), &'static str> {
        if let Some(layer) = layer {
            let index = self.index(layer)?;
            if let Some(image) = &mut self.layers[index].image {
                edit(Arc::make_mut(image))?;
            }
        } else {
            for image in self
                .layers
                .iter_mut()
                .filter_map(|layer| layer.image.as_mut())
            {
                edit(Arc::make_mut(image))?;
            }
        }
        Ok(())
    }

    fn geometry(&mut self, operation: &Operation) -> Result<(), &'static str> {
        let (width, height) = match *operation {
            Operation::Crop {
                x,
                y,
                width,
                height,
            } => {
                if width > self.width
                    || height > self.height
                    || x > self.width - width
                    || y > self.height - height
                {
                    return Err("The crop must fit inside the current image.");
                }
                (width, height)
            }
            Operation::Resize { width, height } => (width, height),
            Operation::Rotate { degrees: 90 | 270 } => (self.height, self.width),
            Operation::Rotate { degrees: 180 } | Operation::Flip { .. } => {
                (self.width, self.height)
            }
            Operation::Rotate { .. } => return Err("Choose a rotation of 90, 180 or 270 degrees."),
            _ => unreachable!("only geometry operations reach this method"),
        };
        self.check_size(width, height, self.buffers().count())?;
        for layer in &mut self.layers {
            for image in layer.image.iter_mut().chain(layer.mask.iter_mut()) {
                *image = Arc::new(image.transformed(operation)?);
            }
        }
        self.width = width;
        self.height = height;
        Ok(())
    }
}

fn blank(width: usize, height: usize, alpha: u8) -> Image {
    let mut pixels = vec![0; width * height * 4];
    if alpha != 0 {
        for pixel in pixels.as_chunks_mut::<4>().0 {
            pixel[3] = alpha;
        }
    }
    Image {
        width,
        height,
        pixels,
    }
}

fn layer_name(name: &str) -> Result<String, &'static str> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
        return Err("Use a layer name of 1 to 80 visible characters.");
    }
    Ok(name.to_owned())
}
