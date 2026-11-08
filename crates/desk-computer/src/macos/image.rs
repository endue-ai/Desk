//! A CGImage as straight RGBA pixels at a chosen size: drawn into a bitmap context of a known
//! format, so any source format (BGRA, HDR, another color space) comes out the same way.

use std::ffi::c_void;

use objc2_core_foundation::{CGPoint, CGRect, CGSize};
use objc2_core_graphics::{
    CGBitmapContextCreate, CGColorSpace, CGContext, CGImage, CGImageAlphaInfo,
    CGImageByteOrderInfo, CGInterpolationQuality, kCGColorSpaceSRGB,
};

use crate::screen::unpremultiply;
use crate::{Error, ErrorCode};

/// `image` scaled to `width` × `height`, as sRGB RGBA, top row first.
pub(super) fn rgba(image: &CGImage, width: u32, height: u32) -> Result<Vec<u8>, Error> {
    let failed = |what: &str| Error::new(ErrorCode::IoError, format!("screenshot: {what}"));
    let (w, h) = (width as usize, height as usize);
    let row = w.checked_mul(4).ok_or_else(|| failed("too wide"))?;
    let mut pixels = vec![0u8; row.checked_mul(h).ok_or_else(|| failed("too large"))?];
    // SAFETY: the framework's constant name of the sRGB space.
    let space = CGColorSpace::with_name(Some(unsafe { kCGColorSpaceSRGB }))
        .ok_or_else(|| failed("no sRGB color space"))?;
    let info = CGImageAlphaInfo::PremultipliedLast.0 | CGImageByteOrderInfo::Order32Big.0;
    // SAFETY: `pixels` holds `h` rows of `row` bytes, 8 bits a component and 4 components a pixel,
    // and outlives the context, which is dropped at the end of this function.
    let context = unsafe {
        CGBitmapContextCreate(
            pixels.as_mut_ptr().cast::<c_void>(),
            w,
            h,
            8,
            row,
            Some(&*space),
            info,
        )
    }
    .ok_or_else(|| failed("no bitmap context"))?;
    CGContext::set_interpolation_quality(Some(&*context), CGInterpolationQuality::High);
    let all = CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(w as f64, h as f64));
    CGContext::draw_image(Some(&*context), all, Some(image));
    drop(context);
    unpremultiply(&mut pixels);
    Ok(pixels)
}

/// The image's own size in pixels.
pub(super) fn size(image: &CGImage) -> (u32, u32) {
    (
        CGImage::width(Some(image)) as u32,
        CGImage::height(Some(image)) as u32,
    )
}
