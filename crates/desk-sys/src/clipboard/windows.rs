//! The Windows clipboard through user32 and kernel32, `CF_UNICODETEXT` only. This module is allowed
//! `unsafe` (the workspace denies it elsewhere) for the FFI calls; nothing unsafe leaves it, and the
//! clipboard is opened and closed within each call.
//!
//! `state` reads `GetClipboardSequenceNumber` and which formats are available, opening the clipboard
//! only to read the 4-byte `CanIncludeInClipboardHistory` value, never the text. Concealed is
//! `ExcludeClipboardContentFromMonitorProcessing` or `Clipboard Viewer Ignore` (any data);
//! transient is `CanIncludeInClipboardHistory` holding 0. A concealed write sets both concealed
//! formats, and a concealed or transient write sets `CanIncludeInClipboardHistory` and
//! `CanUploadToCloudClipboard` to 0, so a concealed write also reads back transient. The marks go
//! on before the text.
#![allow(unsafe_code)]

use std::ffi::c_void;
use std::io;
use std::ptr;
use std::thread;
use std::time::Duration;

use super::{Clipboard, Marks, State, check_text};
use crate::{Error, ErrorCode};

type Handle = *mut c_void;

const CF_UNICODETEXT: u32 = 13;
const GMEM_MOVEABLE: u32 = 0x0002;
/// `OpenClipboard` fails while another app holds the clipboard: try for about 100 ms.
const OPEN_TRIES: u32 = 10;
const OPEN_WAIT: Duration = Duration::from_millis(10);
/// How often `state` reads again when the sequence number moved while it read the formats.
const STATE_TRIES: usize = 3;

#[link(name = "user32")]
unsafe extern "system" {
    fn OpenClipboard(owner: Handle) -> i32;
    fn CloseClipboard() -> i32;
    fn EmptyClipboard() -> i32;
    fn GetClipboardData(format: u32) -> Handle;
    fn SetClipboardData(format: u32, memory: Handle) -> Handle;
    fn GetClipboardSequenceNumber() -> u32;
    fn IsClipboardFormatAvailable(format: u32) -> i32;
    fn RegisterClipboardFormatW(name: *const u16) -> u32;
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn GlobalAlloc(flags: u32, bytes: usize) -> Handle;
    fn GlobalLock(memory: Handle) -> *mut c_void;
    fn GlobalUnlock(memory: Handle) -> i32;
    fn GlobalSize(memory: Handle) -> usize;
    fn GlobalFree(memory: Handle) -> Handle;
}

/// The registered formats of the marks; the ids are the same for every process in the session.
pub(super) struct WindowsClipboard {
    exclude: u32,
    viewer_ignore: u32,
    history: u32,
    cloud: u32,
}

impl WindowsClipboard {
    pub(super) fn new() -> Result<Self, Error> {
        Ok(Self {
            exclude: register("ExcludeClipboardContentFromMonitorProcessing")?,
            viewer_ignore: register("Clipboard Viewer Ignore")?,
            history: register("CanIncludeInClipboardHistory")?,
            cloud: register("CanUploadToCloudClipboard")?,
        })
    }

    /// The marks, from the formats available and `CanIncludeInClipboardHistory`'s value.
    fn marks(&self) -> Result<Marks, Error> {
        let concealed = available(self.exclude) || available(self.viewer_ignore);
        let transient = available(self.history) && {
            let _open = Open::clipboard()?;
            read_dword(self.history) == Some(0)
        };
        Ok(Marks {
            concealed,
            transient,
        })
    }

    /// Sets the marks' formats and then the text; the clipboard is open and emptied.
    fn put(&self, wide: &[u16], marks: Marks) -> Result<(), Error> {
        let zero = 0u32.to_ne_bytes();
        if marks.concealed {
            set(self.exclude, &zero)?;
            set(self.viewer_ignore, &zero)?;
        }
        if marks.concealed || marks.transient {
            set(self.history, &zero)?;
            set(self.cloud, &zero)?;
        }
        let bytes: Vec<u8> = wide.iter().flat_map(|unit| unit.to_ne_bytes()).collect();
        set(CF_UNICODETEXT, &bytes)
    }
}

impl Clipboard for WindowsClipboard {
    fn state(&self) -> Result<State, Error> {
        let mut tries = 0;
        loop {
            // SAFETY: no arguments; it reads the window station's counter.
            let before = unsafe { GetClipboardSequenceNumber() };
            let has_text = available(CF_UNICODETEXT);
            let marks = self.marks()?;
            tries += 1;
            // SAFETY: as above.
            if unsafe { GetClipboardSequenceNumber() } == before || tries == STATE_TRIES {
                return Ok(State {
                    count: u64::from(before),
                    has_text,
                    marks,
                });
            }
        }
    }

    fn read_text(&self) -> Result<Option<String>, Error> {
        let _open = Open::clipboard()?;
        // SAFETY: the clipboard is open; the handle stays the clipboard's and is only read.
        let memory = unsafe { GetClipboardData(CF_UNICODETEXT) };
        if memory.is_null() {
            return Ok(None);
        }
        let locked = Locked::new(memory).ok_or_else(|| os_error("GlobalLock on the text"))?;
        let units = locked.size / 2;
        // SAFETY: the locked block is `size` bytes long, global memory is aligned for u16, and the
        // slice lives while the block is locked and the clipboard open.
        let wide = unsafe { std::slice::from_raw_parts(locked.data.cast::<u16>(), units) };
        let end = wide.iter().position(|&unit| unit == 0).unwrap_or(units);
        Ok(Some(String::from_utf16_lossy(&wide[..end])))
    }

    fn write_text(&self, text: &str, marks: Marks) -> Result<(), Error> {
        check_text(text)?;
        let wide: Vec<u16> = text.encode_utf16().chain(Some(0)).collect();
        let _open = Open::clipboard()?;
        // SAFETY: the clipboard is open by this thread.
        if unsafe { EmptyClipboard() } == 0 {
            return Err(os_error("EmptyClipboard"));
        }
        let put = self.put(&wide, marks);
        if put.is_err() {
            // Never leave text without the marks it was written with.
            // SAFETY: as above.
            unsafe { EmptyClipboard() };
        }
        put
    }
}

/// The clipboard, open by this thread until dropped.
struct Open;

impl Open {
    fn clipboard() -> Result<Self, Error> {
        let mut last = None;
        for _ in 0..OPEN_TRIES {
            // SAFETY: a null owner is documented as allowed: the clipboard is opened by this task.
            if unsafe { OpenClipboard(ptr::null_mut()) } != 0 {
                return Ok(Self);
            }
            last = Some(io::Error::last_os_error());
            thread::sleep(OPEN_WAIT);
        }
        let reason = last.map_or_else(String::new, |err| format!(": {err}"));
        Err(Error::new(
            ErrorCode::IoError,
            format!("another app holds the clipboard; OpenClipboard failed for 100 ms{reason}"),
        ))
    }
}

impl Drop for Open {
    fn drop(&mut self) {
        // SAFETY: this thread opened the clipboard in `Open::clipboard`.
        unsafe { CloseClipboard() };
    }
}

/// A locked global memory block, unlocked when dropped.
struct Locked {
    memory: Handle,
    data: *mut c_void,
    size: usize,
}

impl Locked {
    fn new(memory: Handle) -> Option<Self> {
        // SAFETY: `memory` is a global memory handle the caller holds for the lock's lifetime.
        let data = unsafe { GlobalLock(memory) };
        if data.is_null() {
            return None;
        }
        // SAFETY: as above.
        let size = unsafe { GlobalSize(memory) };
        Some(Self { memory, data, size })
    }
}

impl Drop for Locked {
    fn drop(&mut self) {
        // SAFETY: `memory` was locked once in `Locked::new`.
        unsafe { GlobalUnlock(self.memory) };
    }
}

fn register(name: &str) -> Result<u32, Error> {
    let wide: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
    // SAFETY: `wide` is a NUL-terminated UTF-16 string that outlives the call.
    let format = unsafe { RegisterClipboardFormatW(wide.as_ptr()) };
    if format == 0 {
        return Err(os_error(&format!("RegisterClipboardFormatW({name})")));
    }
    Ok(format)
}

fn available(format: u32) -> bool {
    // SAFETY: it reads the clipboard's format list and needs no open clipboard.
    unsafe { IsClipboardFormatAvailable(format) != 0 }
}

/// A format's first four bytes as a `u32`, if it holds that many; the clipboard is open.
fn read_dword(format: u32) -> Option<u32> {
    // SAFETY: the caller opened the clipboard; the handle stays the clipboard's and is only read.
    let memory = unsafe { GetClipboardData(format) };
    if memory.is_null() {
        return None;
    }
    let locked = Locked::new(memory)?;
    if locked.size < 4 {
        return None;
    }
    // SAFETY: the locked block holds at least four bytes.
    Some(unsafe { locked.data.cast::<u32>().read_unaligned() })
}

/// Put a copy of `bytes` (never empty) on the open clipboard as `format`; the clipboard then owns
/// the memory.
fn set(format: u32, bytes: &[u8]) -> Result<(), Error> {
    // SAFETY: a movable block of `bytes.len()` bytes; it is freed below unless the clipboard takes
    // it.
    let memory = unsafe { GlobalAlloc(GMEM_MOVEABLE, bytes.len()) };
    if memory.is_null() {
        return Err(os_error("GlobalAlloc"));
    }
    let failed = match Locked::new(memory) {
        Some(locked) => {
            // SAFETY: the block is at least `bytes.len()` bytes and does not overlap `bytes`.
            unsafe { ptr::copy_nonoverlapping(bytes.as_ptr(), locked.data.cast(), bytes.len()) };
            drop(locked);
            // SAFETY: the clipboard is open and emptied by this thread; on success it owns
            // `memory`.
            let taken = unsafe { SetClipboardData(format, memory) };
            taken.is_null().then(|| os_error("SetClipboardData"))
        }
        None => Some(os_error("GlobalLock")),
    };
    if let Some(err) = failed {
        // SAFETY: the clipboard did not take `memory`, so it is still this call's to free.
        unsafe { GlobalFree(memory) };
        return Err(err);
    }
    Ok(())
}

fn os_error(call: &str) -> Error {
    Error::new(
        ErrorCode::IoError,
        format!("{call} failed: {}", io::Error::last_os_error()),
    )
}
