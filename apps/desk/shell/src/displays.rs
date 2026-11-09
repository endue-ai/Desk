//! The displays as the palette and the floating Eris use them (Tauri's `cursor_position`,
//! `monitor_from_point` and `work_area`, which winit has no call for): the display under the
//! pointer, its work area (the screen less the menu bar, the Dock or the taskbar), and placing a
//! window on it. Everything is in physical pixels of winit's global space, as the Tauri shell had.
//! macOS asks AppKit for the pointer and the work area; elsewhere the pointer's display is the
//! primary one and the work area the whole display (a documented gap until the compositor, #32).

use winit::dpi::{LogicalPosition, LogicalSize, PhysicalPosition, PhysicalSize};
use winit::monitor::MonitorHandle;
use winit::window::Window;

use crate::eris_window::place::{Display, Rect, display_key};

/// The display under the pointer, else the primary one, else any.
pub fn cursor_monitor(window: &Window) -> Option<MonitorHandle> {
    let mut monitors = window.available_monitors();
    #[cfg(target_os = "macos")]
    if let Some((x, y)) = mac::pointer()
        && let Some(found) = window.available_monitors().find(|m| {
            let scale = m.scale_factor();
            let at = m.position().to_logical::<f64>(scale);
            let size = m.size().to_logical::<f64>(scale);
            x >= at.x && x < at.x + size.width && y >= at.y && y < at.y + size.height
        })
    {
        return Some(found);
    }
    window.primary_monitor().or_else(|| monitors.next())
}

/// The display as the floating Eris keeps her spot on it.
pub fn display(monitor: &MonitorHandle) -> Display {
    let (origin, size) = (monitor.position(), monitor.size());
    Display {
        key: display_key(
            monitor.name().as_deref(),
            (origin.x, origin.y),
            (size.width, size.height),
        ),
        area: work_area(monitor),
    }
}

/// The part of `monitor` windows may use, in physical pixels.
pub fn work_area(monitor: &MonitorHandle) -> Rect {
    let (origin, size) = (monitor.position(), monitor.size());
    let whole = Rect {
        x: origin.x,
        y: origin.y,
        width: size.width,
        height: size.height,
    };
    #[cfg(target_os = "macos")]
    if let Some(area) = mac::visible(monitor) {
        return area;
    }
    whole
}

/// Where `window` is and how big, in physical pixels.
pub fn rect_of(window: &Window) -> Option<Rect> {
    let at = window.outer_position().ok()?;
    let size = window.outer_size();
    Some(Rect {
        x: at.x,
        y: at.y,
        width: size.width,
        height: size.height,
    })
}

/// Put `window` at `rect` (physical pixels of a display with `scale`). macOS places windows in
/// points, so the rect goes there in the display's own scale rather than the window's.
pub fn place(window: &Window, rect: Rect, scale: f64) {
    if cfg!(target_os = "macos") {
        let _ = window.request_inner_size(LogicalSize::new(
            f64::from(rect.width) / scale,
            f64::from(rect.height) / scale,
        ));
        window.set_outer_position(LogicalPosition::new(
            f64::from(rect.x) / scale,
            f64::from(rect.y) / scale,
        ));
    } else {
        let _ = window.request_inner_size(PhysicalSize::new(rect.width, rect.height));
        window.set_outer_position(PhysicalPosition::new(rect.x, rect.y));
    }
}

/// `size` in logical pixels as physical ones at `scale`.
pub fn physical(size: (f64, f64), scale: f64) -> (u32, u32) {
    (
        (size.0 * scale).round() as u32,
        (size.1 * scale).round() as u32,
    )
}

#[cfg(target_os = "macos")]
mod mac {
    use objc2_app_kit::{NSEvent, NSScreen};
    use objc2_foundation::{MainThreadMarker, NSNumber, NSRect, NSString};
    use winit::monitor::MonitorHandle;
    use winit::platform::macos::MonitorHandleExtMacOS;

    use crate::eris_window::place::Rect;

    /// The primary screen's height in points: AppKit's y grows up from its bottom edge.
    fn primary_height(mtm: MainThreadMarker) -> Option<f64> {
        let screens = NSScreen::screens(mtm);
        let first = screens.firstObject()?;
        Some(first.frame().size.height)
    }

    /// The pointer in winit's global logical space (top-left origin, points).
    pub fn pointer() -> Option<(f64, f64)> {
        let mtm = MainThreadMarker::new()?;
        let at = NSEvent::mouseLocation();
        Some((at.x, primary_height(mtm)? - at.y))
    }

    /// `monitor`'s visible frame (less the menu bar and the Dock) in physical pixels.
    pub fn visible(monitor: &MonitorHandle) -> Option<Rect> {
        let mtm = MainThreadMarker::new()?;
        let id = monitor.native_id();
        let key = NSString::from_str("NSScreenNumber");
        let screens = NSScreen::screens(mtm);
        let screen = screens.iter().find(|screen| {
            screen
                .deviceDescription()
                .objectForKey(&key)
                .and_then(|value| value.downcast::<NSNumber>().ok())
                .is_some_and(|number| number.unsignedIntValue() == id)
        })?;
        let frame: NSRect = screen.visibleFrame();
        let scale = monitor.scale_factor();
        let top = primary_height(mtm)? - (frame.origin.y + frame.size.height);
        Some(Rect {
            x: (frame.origin.x * scale).round() as i32,
            y: (top * scale).round() as i32,
            width: (frame.size.width * scale).round() as u32,
            height: (frame.size.height * scale).round() as u32,
        })
    }
}
