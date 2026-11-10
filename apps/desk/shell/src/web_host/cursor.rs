//! A windowless browser's cursor (#56): CEF's `OnCursorChange` names one of Chromium's cursors, or
//! hands a custom one's BGRA pixels; the surface says it to the compositor as `cursor`, by its CSS
//! keyword or as a PNG image with its hotspot and scale, and the compositor sets the window's.

use base64::Engine;
use cef::sys::cef_cursor_type_t as T;
use cef::*;
use desk_surface::generated::{
    SurfaceCursor, SurfaceCursorChange, SurfaceCursorName as N, SurfaceImageCursor,
    SurfaceNamedCursor,
};

/// The CSS keyword of one of Chromium's cursors.
pub fn named(kind: T) -> N {
    match kind {
        T::CT_CROSS => N::Crosshair,
        T::CT_HAND => N::Pointer,
        T::CT_IBEAM => N::Text,
        T::CT_WAIT => N::Wait,
        T::CT_HELP => N::Help,
        T::CT_EASTRESIZE => N::EResize,
        T::CT_NORTHRESIZE => N::NResize,
        T::CT_NORTHEASTRESIZE => N::NeResize,
        T::CT_NORTHWESTRESIZE => N::NwResize,
        T::CT_SOUTHRESIZE => N::SResize,
        T::CT_SOUTHEASTRESIZE => N::SeResize,
        T::CT_SOUTHWESTRESIZE => N::SwResize,
        T::CT_WESTRESIZE => N::WResize,
        T::CT_NORTHSOUTHRESIZE => N::NsResize,
        T::CT_EASTWESTRESIZE => N::EwResize,
        T::CT_NORTHEASTSOUTHWESTRESIZE => N::NeswResize,
        T::CT_NORTHWESTSOUTHEASTRESIZE => N::NwseResize,
        T::CT_COLUMNRESIZE => N::ColResize,
        T::CT_ROWRESIZE => N::RowResize,
        T::CT_MIDDLEPANNING
        | T::CT_MIDDLE_PANNING_VERTICAL
        | T::CT_MIDDLE_PANNING_HORIZONTAL
        | T::CT_EASTPANNING
        | T::CT_NORTHPANNING
        | T::CT_NORTHEASTPANNING
        | T::CT_NORTHWESTPANNING
        | T::CT_SOUTHPANNING
        | T::CT_SOUTHEASTPANNING
        | T::CT_SOUTHWESTPANNING
        | T::CT_WESTPANNING => N::AllScroll,
        T::CT_MOVE => N::Move,
        T::CT_VERTICALTEXT => N::VerticalText,
        T::CT_CELL => N::Cell,
        T::CT_CONTEXTMENU => N::ContextMenu,
        T::CT_ALIAS | T::CT_DND_LINK => N::Alias,
        T::CT_PROGRESS => N::Progress,
        T::CT_NODROP | T::CT_DND_NONE => N::NoDrop,
        T::CT_COPY | T::CT_DND_COPY => N::Copy,
        T::CT_NONE => N::None,
        T::CT_NOTALLOWED => N::NotAllowed,
        T::CT_ZOOMIN => N::ZoomIn,
        T::CT_ZOOMOUT => N::ZoomOut,
        T::CT_GRAB => N::Grab,
        T::CT_GRABBING => N::Grabbing,
        _ => N::Default,
    }
}

/// A custom cursor's BGRA pixels as a base64 PNG, `None` when they do not hold one (empty, or
/// larger than the protocol's 256 × 256).
pub fn png_of(bgra: &[u8], width: u32, height: u32) -> Option<String> {
    let expected = width as usize * height as usize * 4;
    if width == 0 || height == 0 || width > 256 || height > 256 || bgra.len() < expected {
        return None;
    }
    let rgba: Vec<u8> = bgra[..expected]
        .as_chunks::<4>()
        .0
        .iter()
        .flat_map(|[b, g, r, a]| [*r, *g, *b, *a])
        .collect();
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().ok()?;
        writer.write_image_data(&rgba).ok()?;
    }
    Some(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// The `cursor` message for CEF's cursor `kind` (with `custom`'s pixels when it is one).
pub fn change(surface: &str, kind: CursorType, custom: Option<&CursorInfo>) -> SurfaceCursorChange {
    let raw: T = kind.into();
    let image = custom.filter(|_| raw == T::CT_CUSTOM).and_then(|info| {
        let (w, h) = (
            info.size.width.max(0) as u32,
            info.size.height.max(0) as u32,
        );
        if info.buffer.is_null() {
            return None;
        }
        // SAFETY: CEF hands `width * height` BGRA pixels at `buffer`, valid for this call.
        #[allow(unsafe_code)]
        let pixels = unsafe {
            std::slice::from_raw_parts(info.buffer as *const u8, w as usize * h as usize * 4)
        };
        let png = png_of(pixels, w, h)?;
        Some(SurfaceCursor::SurfaceImage(SurfaceImageCursor {
            kind: Default::default(),
            png,
            hotspot_x: info.hotspot.x.max(0) as u64,
            hotspot_y: info.hotspot.y.max(0) as u64,
            scale: f64::from(info.image_scale_factor.max(0.25)),
        }))
    });
    let cursor = image.unwrap_or_else(|| {
        SurfaceCursor::SurfaceNamed(SurfaceNamedCursor {
            kind: Default::default(),
            name: named(raw),
        })
    });
    SurfaceCursorChange {
        r#type: Default::default(),
        surface: surface.to_owned(),
        cursor,
    }
}

#[cfg(test)]
mod tests {
    use super::{named, png_of};
    use cef::sys::cef_cursor_type_t as T;
    use desk_surface::generated::SurfaceCursorName as N;

    #[test]
    fn chromiums_cursors_are_named_by_their_css_keywords() {
        assert_eq!(named(T::CT_IBEAM), N::Text);
        assert_eq!(named(T::CT_HAND), N::Pointer);
        assert_eq!(named(T::CT_COLUMNRESIZE), N::ColResize);
        assert_eq!(named(T::CT_NONE), N::None);
        assert_eq!(named(T::CT_POINTER), N::Default);
    }

    #[test]
    fn a_custom_cursor_is_a_png_of_at_most_256_pixels() {
        let red_bgra = [0, 0, 255, 255].repeat(4);
        let png = png_of(&red_bgra, 2, 2).expect("a PNG");
        assert!(png.starts_with("iVBORw0KGgo"), "the PNG signature: {png}");
        assert_eq!(png_of(&[0; 4], 300, 1), None, "too wide");
        assert_eq!(png_of(&[], 0, 0), None);
    }
}
