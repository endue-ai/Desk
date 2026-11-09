//! The main window: a winit window holding a windowed CEF browser (Stage 1 of #32; the compositor
//! replaces it in Stage 2). It also runs CEF's message loop work when the pump says it is due.

use std::sync::Arc;
use std::time::Instant;

use cef::*;
use winit::application::ApplicationHandler;
use winit::dpi::LogicalSize;
use winit::event::WindowEvent;
use winit::event_loop::{ActiveEventLoop, ControlFlow};
use winit::window::{Window, WindowId};

use crate::client;
use crate::pump::{Pump, Wake};

/// The shell's application state for winit.
pub struct Shell {
    pump: Pump,
    url: String,
    window: Option<Arc<Window>>,
    browser: Option<Browser>,
}

impl Shell {
    pub fn new(pump: Pump, url: String) -> Self {
        Self {
            pump,
            url,
            window: None,
            browser: None,
        }
    }

    fn open(&mut self, event_loop: &ActiveEventLoop) {
        let attributes = Window::default_attributes()
            .with_title("endue Desk")
            .with_inner_size(LogicalSize::new(1280.0, 800.0))
            .with_min_inner_size(LogicalSize::new(1024.0, 500.0));
        let window = match event_loop.create_window(attributes) {
            Ok(window) => Arc::new(window),
            Err(why) => {
                eprintln!("endue Desk: no window ({why})");
                event_loop.exit();
                return;
            }
        };
        let Some(parent) = parent_handle(&window) else {
            eprintln!("endue Desk: this windowing system cannot hold a CEF browser");
            event_loop.exit();
            return;
        };
        let info = WindowInfo::default().set_as_child(parent, &bounds(&window));
        let mut client = client::main_client(self.pump.clone());
        let browser = browser_host_create_browser_sync(
            Some(&info),
            Some(&mut client),
            Some(&self.url.as_str().into()),
            Some(&BrowserSettings::default()),
            None,
            None,
        );
        #[cfg(target_os = "macos")]
        if let Some(host) = browser.as_ref().and_then(|b| b.host()) {
            crate::mac::follow_parent_size(host.window_handle());
        }
        self.browser = browser;
        self.window = Some(window);
    }
}

impl ApplicationHandler<Wake> for Shell {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_none() {
            self.open(event_loop);
        }
    }

    fn user_event(&mut self, event_loop: &ActiveEventLoop, wake: Wake) {
        if wake == Wake::BrowserClosed {
            self.browser = None;
            event_loop.exit();
        }
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => match self.browser.as_ref().and_then(|b| b.host()) {
                // The page may answer `beforeunload`; the window goes when the browser has closed.
                Some(host) => host.close_browser(0),
                None => event_loop.exit(),
            },
            WindowEvent::Resized(_size) => {
                #[cfg(target_os = "windows")]
                if let (Some(host), Some(window)) = (
                    self.browser.as_ref().and_then(|b| b.host()),
                    self.window.as_ref(),
                ) {
                    resize_child(host.window_handle(), _size.width, _size.height);
                    let _ = window;
                }
            }
            WindowEvent::Focused(true) => {
                if let Some(host) = self.browser.as_ref().and_then(|b| b.host()) {
                    host.set_focus(1);
                }
            }
            _ => {}
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        if self.pump.take_due(Instant::now()) {
            do_message_loop_work();
        }
        event_loop.set_control_flow(ControlFlow::WaitUntil(self.pump.due()));
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
fn parent_handle(window: &Window) -> Option<sys::cef_window_handle_t> {
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
