//! One of the shell's windows: a winit window holding a windowed CEF browser (Stage 1 of #32; the
//! compositor replaces it in Stage 2). The main window, the palette, the floating Eris and the
//! computer-use banner are each one.

use std::sync::Arc;

use cef::*;
use winit::event_loop::ActiveEventLoop;
use winit::window::{Window, WindowAttributes};

/// A window and its browser, once the browser exists.
pub struct Pane {
    pub window: Arc<Window>,
    pub browser: Option<Browser>,
}

impl Pane {
    /// Make a window with `attributes` and a browser in it at `url`, answered by `client`.
    pub fn open(
        event_loop: &ActiveEventLoop,
        attributes: WindowAttributes,
        url: &str,
        mut client: Client,
    ) -> Result<Self, String> {
        let window = event_loop
            .create_window(attributes)
            .map_err(|why| format!("no window ({why})"))?;
        let window = Arc::new(window);
        let parent = parent_handle(&window)
            .ok_or("this windowing system cannot hold a CEF browser".to_owned())?;
        let info = WindowInfo::default().set_as_child(parent, &bounds(&window));
        let browser = browser_host_create_browser_sync(
            Some(&info),
            Some(&mut client),
            Some(&url.into()),
            Some(&BrowserSettings::default()),
            None,
            None,
        );
        #[cfg(target_os = "macos")]
        if let Some(host) = browser.as_ref().and_then(|b| b.host()) {
            crate::mac::follow_parent_size(host.window_handle());
        }
        Ok(Self { window, browser })
    }

    /// The browser's host, while the browser lives.
    pub fn host(&self) -> Option<BrowserHost> {
        self.browser.as_ref().and_then(|b| b.host())
    }

    /// Show the window and give it the keyboard (the app comes forward on macOS).
    pub fn show_and_focus(&self) {
        self.window.set_visible(true);
        self.window.focus_window();
        if let Some(host) = self.host() {
            host.set_focus(1);
        }
    }

    /// Whether the window is on screen.
    pub fn visible(&self) -> bool {
        self.window.is_visible().unwrap_or(true)
    }

    /// Hide the window.
    pub fn hide(&self) {
        self.window.set_visible(false);
    }

    /// Follow a resize of the window (Windows: a child HWND does not follow by itself).
    pub fn resized(&self, size: winit::dpi::PhysicalSize<u32>) {
        #[cfg(target_os = "windows")]
        if let Some(host) = self.host() {
            resize_child(host.window_handle(), size.width, size.height);
        }
        let _ = size;
    }

    /// Close the browser; the window goes when it has (`Wake::Closed`).
    pub fn close(&self, force: bool) {
        if let Some(host) = self.host() {
            host.close_browser(i32::from(force));
        }
    }
}

/// The browser's bounds inside the window: the whole content area, in the units CEF wants
/// (points on macOS, pixels elsewhere).
fn bounds(window: &Window) -> Rect {
    let size = window.inner_size();
    let (width, height) = if cfg!(target_os = "macos") {
        let logical = size.to_logical::<f64>(window.scale_factor());
        (logical.width as i32, logical.height as i32)
    } else {
        (size.width as i32, size.height as i32)
    };
    Rect {
        x: 0,
        y: 0,
        width,
        height,
    }
}

/// The native parent CEF puts its browser view in.
pub fn parent_handle(window: &Window) -> Option<sys::cef_window_handle_t> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    match window.window_handle().ok()?.as_raw() {
        #[cfg(target_os = "macos")]
        RawWindowHandle::AppKit(handle) => Some(handle.ns_view.as_ptr()),
        #[cfg(target_os = "windows")]
        RawWindowHandle::Win32(handle) => Some(handle.hwnd.get() as sys::cef_window_handle_t),
        #[cfg(target_os = "linux")]
        RawWindowHandle::Xlib(handle) => Some(handle.window as sys::cef_window_handle_t),
        _ => None,
    }
}

/// A child HWND does not follow its parent's size by itself.
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
fn resize_child(child: sys::cef_window_handle_t, width: u32, height: u32) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{SWP_NOMOVE, SWP_NOZORDER, SetWindowPos};
    // SAFETY: `child` is the browser's HWND, alive while the browser is.
    unsafe {
        SetWindowPos(
            child as _,
            std::ptr::null_mut(),
            0,
            0,
            width as i32,
            height as i32,
            SWP_NOZORDER | SWP_NOMOVE,
        );
    }
}
