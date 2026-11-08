//! macOS only (ADR 0121): the floating window joins every Space and full-screen Space, stays put in
//! Mission Control and out of window cycling, and shows without taking the focus from the app in
//! front. Tauri sets all workspaces and the floating level; these are the AppKit parts it has no
//! option for.
//!
//! Like `desk-sys`'s AppKit modules, this module is allowed `unsafe` (the workspace denies it
//! everywhere else), for the one pointer Tauri hands out; nothing unsafe leaves it.
#![allow(unsafe_code)]

use std::ffi::c_void;

use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};

/// The window's `NSWindow`. Call on the main thread only, with a pointer Tauri handed out for a
/// window that is still open.
unsafe fn window<'a>(ns_window: *mut c_void) -> Option<&'a NSWindow> {
    // SAFETY: Tauri's `ns_window()` is the window's NSWindow, alive while the window is.
    unsafe { ns_window.cast::<NSWindow>().as_ref() }
}

/// On every Space, over full-screen apps, still in Mission Control, out of ⌘` cycling.
pub fn float(ns_window: *mut c_void) {
    // SAFETY: called from the setup closure and `run_on_main_thread`, on the main thread.
    let Some(window) = (unsafe { window(ns_window) }) else {
        return;
    };
    let behavior = window.collectionBehavior()
        | NSWindowCollectionBehavior::CanJoinAllSpaces
        | NSWindowCollectionBehavior::FullScreenAuxiliary
        | NSWindowCollectionBehavior::Stationary
        | NSWindowCollectionBehavior::IgnoresCycle;
    window.setCollectionBehavior(behavior);
}

/// Show the window over the others without making it key or activating the desk.
pub fn show_quietly(ns_window: *mut c_void) {
    // SAFETY: called from `run_on_main_thread`, on the main thread.
    if let Some(window) = unsafe { window(ns_window) } {
        window.orderFrontRegardless();
    }
}
