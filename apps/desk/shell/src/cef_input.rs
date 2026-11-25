//! The native handles passed to CEF display and keyboard handlers.

#[cfg(target_os = "macos")]
pub(crate) type CursorHandle = *mut u8;
#[cfg(any(target_os = "linux", target_os = "windows"))]
pub(crate) type CursorHandle = cef::CursorHandle;

#[cfg(target_os = "macos")]
pub(crate) type OsEvent<'a> = *mut u8;
#[cfg(target_os = "linux")]
pub(crate) type OsEvent<'a> = Option<&'a mut cef::sys::XEvent>;
#[cfg(target_os = "windows")]
pub(crate) type OsEvent<'a> = Option<&'a mut cef::sys::MSG>;
