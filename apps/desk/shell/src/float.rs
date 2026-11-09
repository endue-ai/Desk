//! Windows that float over every app (ADR 0120, ADR 0121): the floating Eris, the computer-use
//! banner and the palette. On macOS they join every Space (Eris and the banner also full-screen
//! Spaces), stay put in Mission Control and out of ⌘` cycling, and show without taking the focus
//! from the app in front (`orderFrontRegardless`), the AppKit parts winit has no option for. Elsewhere
//! winit's always-on-top level and a hidden taskbar entry are what there is.

use winit::window::{Window, WindowAttributes, WindowLevel};

/// How a floating window starts: no frame, on top, hidden, not focused, out of the taskbar.
pub fn attributes(title: &str, size: (f64, f64)) -> WindowAttributes {
    let attributes = Window::default_attributes()
        .with_title(title)
        .with_inner_size(winit::dpi::LogicalSize::new(size.0, size.1))
        .with_decorations(false)
        .with_resizable(false)
        .with_window_level(WindowLevel::AlwaysOnTop)
        .with_visible(false)
        .with_active(false);
    #[cfg(target_os = "windows")]
    let attributes = {
        use winit::platform::windows::WindowAttributesExtWindows;
        attributes.with_skip_taskbar(true)
    };
    attributes
}

/// Which Spaces a floating window joins on macOS.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Spaces {
    /// Every Space (the palette, as Tauri's `visible_on_all_workspaces`).
    All,
    /// Every Space and full-screen Space, fixed in Mission Control, out of window cycling.
    Over,
}

/// Make `window` join `spaces`. Call on the main thread.
pub fn join(window: &Window, spaces: Spaces) {
    #[cfg(target_os = "macos")]
    mac::join(window, spaces);
    let _ = (window, spaces);
}

/// Show `window` over the others without making it key or activating the desk.
pub fn show_quietly(window: &Window) {
    #[cfg(target_os = "macos")]
    if mac::order_front(window) {
        return;
    }
    window.set_visible(true);
}

#[cfg(target_os = "macos")]
mod mac {
    use objc2::rc::Retained;
    use objc2_app_kit::{NSView, NSWindow, NSWindowCollectionBehavior};
    use objc2_foundation::MainThreadMarker;
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use winit::window::Window;

    use super::Spaces;

    /// The `NSWindow` around winit's view, on the main thread.
    #[allow(unsafe_code)]
    fn ns_window(window: &Window) -> Option<Retained<NSWindow>> {
        MainThreadMarker::new()?;
        let RawWindowHandle::AppKit(handle) = window.window_handle().ok()?.as_raw() else {
            return None;
        };
        let view = handle.ns_view.as_ptr().cast::<NSView>();
        // SAFETY: winit's handle is its live content view, and this runs on the main thread.
        let view = unsafe { view.as_ref() }?;
        view.window()
    }

    pub fn join(window: &Window, spaces: Spaces) {
        let Some(ns_window) = ns_window(window) else {
            return;
        };
        let mut behavior =
            ns_window.collectionBehavior() | NSWindowCollectionBehavior::CanJoinAllSpaces;
        if spaces == Spaces::Over {
            behavior |= NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::IgnoresCycle;
        }
        ns_window.setCollectionBehavior(behavior);
    }

    pub fn order_front(window: &Window) -> bool {
        let Some(ns_window) = ns_window(window) else {
            return false;
        };
        ns_window.orderFrontRegardless();
        true
    }
}
