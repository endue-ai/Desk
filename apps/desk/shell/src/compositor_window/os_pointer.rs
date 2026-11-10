//! Where the OS pointer is while the OS drags files over the window (#56). winit 0.30 tells a file
//! drag only by its events (hovered, dropped, cancelled), with no position, and the window hears no
//! pointer moves meanwhile; so the compositor asks the OS where the pointer is, in the window's
//! device pixels. Linux has no such question here: the last position winit reported stands (#61).

use winit::window::Window;

/// The pointer's position in `window`'s device pixels, when the OS says it.
#[cfg(target_os = "macos")]
pub fn position(window: &Window) -> Option<(f64, f64)> {
    use objc2_app_kit::{NSEvent, NSScreen};
    use objc2_foundation::MainThreadMarker;
    let mtm = MainThreadMarker::new()?;
    // Screen points from the bottom left of the primary screen; winit counts from its top left.
    let at = NSEvent::mouseLocation();
    let primary = NSScreen::screens(mtm).firstObject()?.frame();
    let scale = window.scale_factor();
    let inner = window.inner_position().ok()?;
    let x = at.x * scale - f64::from(inner.x);
    let y = (primary.size.height - at.y) * scale - f64::from(inner.y);
    Some((x, y))
}

/// The pointer's position in `window`'s device pixels, when the OS says it.
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
pub fn position(window: &Window) -> Option<(f64, f64)> {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut at = POINT { x: 0, y: 0 };
    // SAFETY: GetCursorPos writes one POINT through a valid pointer.
    if unsafe { GetCursorPos(&mut at) } == 0 {
        return None;
    }
    let inner = window.inner_position().ok()?;
    Some((f64::from(at.x - inner.x), f64::from(at.y - inner.y)))
}

/// The pointer's position in `window`'s device pixels, when the OS says it.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn position(_window: &Window) -> Option<(f64, f64)> {
    None
}
