//! Displays and the window list, from CoreGraphics. Neither needs a permission, but without Screen
//! Recording the window server leaves other apps' window titles out.

use std::collections::HashMap;

use objc2_app_kit::NSRunningApplication;
use objc2_core_foundation::{CFDictionary, CFString, CGRect};
use objc2_core_graphics::{
    CGDirectDisplayID, CGDisplayBounds, CGDisplayCopyDisplayMode, CGDisplayIsBuiltin,
    CGDisplayMode, CGError, CGGetActiveDisplayList, CGMainDisplayID,
    CGRectMakeWithDictionaryRepresentation, CGWindowListCopyWindowInfo, CGWindowListOption,
    kCGNullWindowID, kCGWindowAlpha, kCGWindowBounds, kCGWindowIsOnscreen, kCGWindowLayer,
    kCGWindowName, kCGWindowNumber, kCGWindowOwnerName, kCGWindowOwnerPID,
};

use super::cf;
use crate::screen::{Display, Window, WindowScope};
use crate::{Error, ErrorCode, Rect};

/// The most displays a Mac drives at once, with room to spare.
const MAX_DISPLAYS: usize = 32;

pub(super) fn rect(rect: CGRect) -> Rect {
    Rect::new(
        rect.origin.x,
        rect.origin.y,
        rect.size.width,
        rect.size.height,
    )
}

pub(super) fn display_ids() -> Result<Vec<CGDirectDisplayID>, Error> {
    let mut ids = [0 as CGDirectDisplayID; MAX_DISPLAYS];
    let mut count = 0u32;
    // SAFETY: `ids` holds `MAX_DISPLAYS` entries and `count` is a valid out-pointer.
    let error =
        unsafe { CGGetActiveDisplayList(MAX_DISPLAYS as u32, ids.as_mut_ptr(), &mut count) };
    if error != CGError::Success {
        return Err(Error::new(
            ErrorCode::IoError,
            format!("the display list failed (CGError {})", error.0),
        ));
    }
    Ok(ids[..(count as usize).min(MAX_DISPLAYS)].to_vec())
}

/// Pixels per point of a display: its mode's pixel width over its width in points.
pub(super) fn scale(id: CGDirectDisplayID) -> f64 {
    let mode = CGDisplayCopyDisplayMode(id);
    let (pixels, points) = (
        CGDisplayMode::pixel_width(mode.as_deref()),
        CGDisplayMode::width(mode.as_deref()),
    );
    if pixels == 0 || points == 0 {
        1.0
    } else {
        pixels as f64 / points as f64
    }
}

pub(super) fn displays() -> Result<Vec<Display>, Error> {
    let main = CGMainDisplayID();
    let mut displays: Vec<Display> = display_ids()?
        .into_iter()
        .map(|id| Display {
            id,
            bounds: rect(CGDisplayBounds(id)),
            scale: scale(id),
            main: id == main,
            builtin: CGDisplayIsBuiltin(id),
        })
        .collect();
    displays.sort_by_key(|d| !d.main);
    Ok(displays)
}

/// The windows front to back; titles only when `titles` (Screen Recording) allows them.
pub(super) fn windows(scope: WindowScope, titles: bool) -> Result<Vec<Window>, Error> {
    let options = match scope {
        WindowScope::OnScreen => CGWindowListOption::OptionOnScreenOnly,
        WindowScope::All => CGWindowListOption::OptionAll,
    } | CGWindowListOption::ExcludeDesktopElements;
    let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID).ok_or_else(|| {
        Error::new(
            ErrorCode::IoError,
            "the window server did not answer the window list",
        )
    })?;
    let mut bundles: HashMap<i32, Option<String>> = HashMap::new();
    Ok(cf::items::<CFDictionary>(&list)
        .iter()
        .filter_map(|info| window(info, titles, &mut bundles))
        .collect())
}

fn window(
    info: &CFDictionary,
    titles: bool,
    bundles: &mut HashMap<i32, Option<String>>,
) -> Option<Window> {
    // SAFETY: the window list's keys are the framework's constant strings.
    let key = |key: &'static CFString| cf::entry(info, key);
    let (number, pid, owner, name, bounds, layer, on_screen, alpha) = unsafe {
        (
            key(kCGWindowNumber),
            key(kCGWindowOwnerPID),
            key(kCGWindowOwnerName),
            key(kCGWindowName),
            key(kCGWindowBounds),
            key(kCGWindowLayer),
            key(kCGWindowIsOnscreen),
            key(kCGWindowAlpha),
        )
    };
    let (number, pid) = (number?, pid?);
    let id = cf::number(&number)? as u32;
    let pid = cf::number(&pid)? as i32;
    let mut frame = CGRect::default();
    if let Some(bounds) = bounds.and_then(|b| b.downcast::<CFDictionary>().ok()) {
        // SAFETY: `kCGWindowBounds` is a CGRect dictionary representation; `frame` is valid.
        unsafe { CGRectMakeWithDictionaryRepresentation(Some(&*bounds), &mut frame) };
    }
    let bundle_id = bundles
        .entry(pid)
        .or_insert_with(|| {
            NSRunningApplication::runningApplicationWithProcessIdentifier(pid)
                .and_then(|app| app.bundleIdentifier())
                .map(|id| id.to_string())
        })
        .clone();
    Some(Window {
        id,
        pid,
        app: owner.and_then(|o| cf::string(&o)).unwrap_or_default(),
        bundle_id,
        title: name
            .filter(|_| titles)
            .and_then(|n| cf::string(&n))
            .filter(|t| !t.is_empty()),
        bounds: rect(frame),
        layer: layer.and_then(|l| cf::number(&l)).unwrap_or(0.0) as i32,
        on_screen: on_screen.and_then(|o| cf::boolean(&o)).unwrap_or(false),
        alpha: alpha.and_then(|a| cf::number(&a)).unwrap_or(1.0),
    })
}
