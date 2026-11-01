//! `ShellExecuteW`, the one Windows call desk-sys makes for `shell.open`: the system opens a URL in
//! its default app. This module is allowed `unsafe` (the workspace denies it elsewhere) for the one
//! FFI call; nothing unsafe leaves it.
#![allow(unsafe_code)]

use std::ffi::c_void;
use std::ptr;

use crate::{Error, ErrorCode};

const SW_SHOWNORMAL: i32 = 1;

#[link(name = "shell32")]
unsafe extern "system" {
    fn ShellExecuteW(
        hwnd: *mut c_void,
        operation: *const u16,
        file: *const u16,
        parameters: *const u16,
        directory: *const u16,
        show: i32,
    ) -> *mut c_void;
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}

/// Open `file` (a checked URL) with the `open` verb. ShellExecuteW answers more than 32 on success.
pub(super) fn shell_execute(file: &str) -> Result<(), Error> {
    let (verb, target) = (wide("open"), wide(file));
    // SAFETY: both strings are NUL-terminated UTF-16 buffers that outlive the call; a null window,
    // parameters and directory are documented as allowed.
    let answer = unsafe {
        ShellExecuteW(
            ptr::null_mut(),
            verb.as_ptr(),
            target.as_ptr(),
            ptr::null(),
            ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    let code = answer as isize;
    if code > 32 {
        return Ok(());
    }
    let message = format!("Windows could not open {file} (ShellExecuteW answered {code})");
    Err(Error::new(ErrorCode::IoError, message))
}
