//! A display coming or going (ADR 0204). When a display goes, macOS moves the windows on it to
//! another: that move is not the person's, so the island keeps nothing while the displays change and
//! goes back to the display the person left it on once they have settled. CoreGraphics calls back
//! for every reconfiguration, a begin and an end for each display; winit has no event for it.
//! Elsewhere nothing calls back, and the island stays where the OS puts it.

use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering::Relaxed};
use std::sync::mpsc::Sender;

/// Where to say that the displays changed (a debounce: once they have settled).
static SETTLED: OnceLock<Sender<()>> = OnceLock::new();
/// The displays are changing: windows move that the person did not move.
static CHANGING: AtomicBool = AtomicBool::new(false);

/// Hear the displays change from now on, once per run.
pub fn listen(settled: Sender<()>) {
    if SETTLED.set(settled).is_ok() {
        #[cfg(target_os = "macos")]
        mac::register();
    }
}

/// Whether the displays are changing: a move now is the OS's.
pub fn changing() -> bool {
    CHANGING.load(Relaxed)
}

/// The island has been placed after a change.
pub fn settled() {
    CHANGING.store(false, Relaxed);
}

/// One reconfiguration of one display: its begin marks the change, the rest say it settles.
fn reconfigured(begins: bool) {
    if begins {
        CHANGING.store(true, Relaxed);
    } else if let Some(settled) = SETTLED.get() {
        let _ = settled.send(());
    }
}

#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
mod mac {
    use std::ffi::c_void;

    /// `kCGDisplayBeginConfigurationFlag`.
    const BEGIN: u32 = 1;

    type Callback = extern "C" fn(display: u32, flags: u32, info: *mut c_void);

    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGDisplayRegisterReconfigurationCallback(callback: Callback, info: *mut c_void) -> i32;
    }

    extern "C" fn changed(_display: u32, flags: u32, _info: *mut c_void) {
        super::reconfigured(flags & BEGIN != 0);
    }

    pub fn register() {
        // SAFETY: `changed` lives for the whole run and touches only statics; no info is passed.
        let error =
            unsafe { CGDisplayRegisterReconfigurationCallback(changed, std::ptr::null_mut()) };
        if error != 0 {
            eprintln!("island: the displays are not followed (CoreGraphics error {error})");
        }
    }
}

#[cfg(test)]
pub(super) fn reconfigure_for_test(begins: bool) {
    reconfigured(begins);
}
