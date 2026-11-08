//! What is on the screen: displays, windows and screenshots. Screenshots leave as PNG bytes with
//! their size in pixels, the area they cover in points and the scale between the two, so a caller
//! maps a pixel `(px, py)` back to the point `bounds.x + px / scale, bounds.y + py / scale`.

use crate::{Error, ErrorCode, Rect, invalid};

/// One active display.
#[derive(Debug, Clone, PartialEq)]
pub struct Display {
    /// `CGDirectDisplayID` on macOS.
    pub id: u32,
    /// In global points.
    pub bounds: Rect,
    /// Pixels per point (2 on a Retina display).
    pub scale: f64,
    /// The main display holds the menu bar and the origin of global coordinates.
    pub main: bool,
    pub builtin: bool,
}

/// Which windows `windows` lists.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub enum WindowScope {
    /// Windows on screen now, front to back.
    #[default]
    OnScreen,
    /// Every window, minimized and other spaces' ones included.
    All,
}

/// One window of any app, as the window server sees it.
#[derive(Debug, Clone, PartialEq)]
pub struct Window {
    /// `kCGWindowNumber` on macOS; what `Target::Window` takes.
    pub id: u32,
    /// The owner's process id.
    pub pid: i32,
    /// The owner's name.
    pub app: String,
    pub bundle_id: Option<String>,
    /// `None` without the Screen Recording permission, or when the window has none.
    pub title: Option<String>,
    pub bounds: Rect,
    /// 0 for normal windows; panels, menus, the Dock and the menu bar sit higher.
    pub layer: i32,
    pub on_screen: bool,
    /// 0 (transparent) to 1.
    pub alpha: f64,
}

/// What a screenshot shows.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Target {
    /// The display that holds the menu bar.
    MainDisplay,
    /// A display by its `Display::id`.
    Display(u32),
    /// One window by its `Window::id`, without what covers it.
    Window(u32),
    /// An area in global points, taken from the display it overlaps most.
    Region(Rect),
}

/// A screenshot request: the target, and at most how many pixels wide and high the image may be.
/// A bound keeps the aspect ratio and never enlarges.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Capture {
    pub target: Target,
    pub max_width: Option<u32>,
    pub max_height: Option<u32>,
}

impl Capture {
    /// At the display's full resolution.
    pub fn of(target: Target) -> Self {
        Self {
            target,
            max_width: None,
            max_height: None,
        }
    }

    /// At most `width` × `height` pixels.
    pub fn fit(mut self, width: u32, height: u32) -> Self {
        self.max_width = Some(width);
        self.max_height = Some(height);
        self
    }

    /// The size in pixels for an area of `points` at `scale`, within the bounds. `invalid_params`
    /// for an empty area or a zero bound.
    pub fn pixels(&self, points: Rect, scale: f64) -> Result<(u32, u32), Error> {
        if !points.is_usable() || !(scale.is_finite() && scale > 0.0) {
            return Err(invalid(format!("nothing to capture in {points}")));
        }
        if self.max_width == Some(0) || self.max_height == Some(0) {
            return Err(invalid(
                "a screenshot must be at least 1 pixel wide and high",
            ));
        }
        let (width, height) = (points.width * scale, points.height * scale);
        let mut ratio: f64 = 1.0;
        if let Some(max) = self.max_width {
            ratio = ratio.min(f64::from(max) / width);
        }
        if let Some(max) = self.max_height {
            ratio = ratio.min(f64::from(max) / height);
        }
        let side = |length: f64| (length * ratio).round().clamp(1.0, f64::from(u32::MAX)) as u32;
        Ok((side(width), side(height)))
    }
}

/// A screenshot as PNG.
#[derive(Debug, Clone, PartialEq)]
pub struct Screenshot {
    pub png: Vec<u8>,
    /// In pixels.
    pub width: u32,
    pub height: u32,
    /// Pixels per point in this image (after any `Capture` bound).
    pub scale: f64,
    /// The area it shows, in global points.
    pub bounds: Rect,
}

impl Screenshot {
    /// Encode straight RGBA pixels, `width * 4` bytes a row, top row first.
    pub fn from_rgba(width: u32, height: u32, rgba: &[u8], bounds: Rect) -> Result<Self, Error> {
        let png = encode_png(width, height, rgba)?;
        let scale = if bounds.width > 0.0 {
            f64::from(width) / bounds.width
        } else {
            1.0
        };
        Ok(Self {
            png,
            width,
            height,
            scale,
            bounds,
        })
    }

    /// One color over `bounds` at `scale`, for fakes and tests.
    pub fn solid(bounds: Rect, scale: f64, rgba: [u8; 4]) -> Result<Self, Error> {
        let (width, height) = Capture::of(Target::Region(bounds)).pixels(bounds, scale)?;
        let pixels = rgba.repeat(width as usize * height as usize);
        Self::from_rgba(width, height, &pixels, bounds)
    }
}

/// PNG bytes of straight (not premultiplied) RGBA pixels, `width * 4` bytes a row, top row first.
pub fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, Error> {
    let expected = width as usize * height as usize * 4;
    if width == 0 || height == 0 || rgba.len() != expected {
        return Err(invalid(format!(
            "{} bytes are not {width}×{height} RGBA pixels",
            rgba.len()
        )));
    }
    let failed = |e: png::EncodingError| Error::new(ErrorCode::Internal, format!("PNG: {e}"));
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(png::Compression::Fast);
        let mut writer = encoder.write_header().map_err(failed)?;
        writer.write_image_data(rgba).map_err(failed)?;
        writer.finish().map_err(failed)?;
    }
    Ok(bytes)
}

/// Turn premultiplied RGBA into straight RGBA in place; opaque pixels stay as they are.
pub fn unpremultiply(rgba: &mut [u8]) {
    for pixel in rgba.as_chunks_mut::<4>().0 {
        let alpha = u16::from(pixel[3]);
        if alpha != 0 && alpha != 255 {
            for channel in &mut pixel[..3] {
                *channel = ((u16::from(*channel) * 255 + alpha / 2) / alpha).min(255) as u8;
            }
        }
    }
}
