use super::Image;

impl Image {
    pub(crate) fn adjust(
        &mut self,
        brightness: i32,
        contrast: i32,
        saturation: i32,
    ) -> Result<(), &'static str> {
        if [brightness, contrast, saturation]
            .iter()
            .any(|value| !(-100..=100).contains(value))
        {
            return Err("Use adjustment values between -100 and 100.");
        }
        let brightness = brightness as f32 * 2.55;
        let contrast = 1.0 + contrast as f32 / 100.0;
        let saturation = 1.0 + saturation as f32 / 100.0;
        for pixel in self.pixels.as_chunks_mut::<4>().0 {
            let luma = f32::from(pixel[0]) * 0.2126
                + f32::from(pixel[1]) * 0.7152
                + f32::from(pixel[2]) * 0.0722;
            for channel in &mut pixel[..3] {
                let color = luma + (f32::from(*channel) - luma) * saturation;
                *channel = ((color - 127.5) * contrast + 127.5 + brightness).round() as u8;
            }
        }
        Ok(())
    }

    pub(crate) fn invert(&mut self) {
        for pixel in self.pixels.as_chunks_mut::<4>().0 {
            for channel in &mut pixel[..3] {
                *channel = 255 - *channel;
            }
        }
    }

    pub(crate) fn blur(&mut self, radius: usize) -> Result<(), &'static str> {
        if !(1..=32).contains(&radius) {
            return Err("Use a blur radius from 1 to 32 pixels.");
        }
        self.pixels = box_pass(&self.pixels, self.width, self.height, radius, false);
        self.pixels = box_pass(&self.pixels, self.height, self.width, radius, true);
        Ok(())
    }

    pub(crate) fn sharpen(&mut self, amount: usize) -> Result<(), &'static str> {
        if !(1..=100).contains(&amount) {
            return Err("Use a sharpen amount from 1 to 100.");
        }
        let horizontal = box_pass(&self.pixels, self.width, self.height, 1, false);
        let blurred = box_pass(&horizontal, self.height, self.width, 1, true);
        for (pixel, soft) in self
            .pixels
            .as_chunks_mut::<4>()
            .0
            .iter_mut()
            .zip(blurred.as_chunks::<4>().0)
        {
            for channel in 0..3 {
                let color = i32::from(pixel[channel]);
                let difference = color - i32::from(soft[channel]);
                pixel[channel] = (color + difference * amount as i32 / 100).clamp(0, 255) as u8;
            }
        }
        Ok(())
    }
}

/// A separable box blur with a sliding sum. RGB is weighted by alpha so transparent pixels
/// contribute no hidden color. Edges are extended by the nearest pixel.
fn box_pass(pixels: &[u8], length: usize, lines: usize, radius: usize, vertical: bool) -> Vec<u8> {
    let mut output = vec![0; pixels.len()];
    let count = (radius * 2 + 1) as u32;
    for line in 0..lines {
        let index = |step: usize| {
            if vertical {
                (step * lines + line) * 4
            } else {
                (line * length + step) * 4
            }
        };
        let pixel = |step: usize| {
            let i = index(step.min(length - 1));
            let a = u32::from(pixels[i + 3]);
            [
                u32::from(pixels[i]) * a,
                u32::from(pixels[i + 1]) * a,
                u32::from(pixels[i + 2]) * a,
                a,
            ]
        };
        let mut sum = [0; 4];
        for step in 0..=radius * 2 {
            let values = pixel(step.saturating_sub(radius));
            for channel in 0..4 {
                sum[channel] += values[channel];
            }
        }
        for step in 0..length {
            let i = index(step);
            let alpha = sum[3];
            for channel in 0..3 {
                output[i + channel] =
                    (sum[channel] + alpha / 2).checked_div(alpha).unwrap_or(0) as u8;
            }
            output[i + 3] = ((alpha + count / 2) / count) as u8;
            let old = pixel(step.saturating_sub(radius));
            let new = pixel(step + radius + 1);
            for channel in 0..4 {
                sum[channel] = sum[channel] + new[channel] - old[channel];
            }
        }
    }
    output
}
