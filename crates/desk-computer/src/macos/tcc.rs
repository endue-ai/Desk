//! TCC: whether this process is trusted for Accessibility and allowed to capture the screen, the
//! prompts that ask, and the System Settings panes that grant them.

use objc2_app_kit::NSWorkspace;
use objc2_application_services::{
    AXIsProcessTrusted, AXIsProcessTrustedWithOptions, kAXTrustedCheckOptionPrompt,
};
use objc2_core_foundation::{CFBoolean, CFDictionary};
use objc2_core_graphics::{CGPreflightScreenCaptureAccess, CGRequestScreenCaptureAccess};
use objc2_foundation::{NSBundle, NSString, NSURL};

use crate::{Error, ErrorCode};

/// Whether this process is trusted for Accessibility. With `prompt`, macOS shows its dialog (once
/// per process) pointing the person at System Settings; the answer is the status before they act.
pub(super) fn accessibility(prompt: bool) -> bool {
    if !prompt {
        // SAFETY: takes nothing and reads the TCC status.
        return unsafe { AXIsProcessTrusted() };
    }
    // SAFETY: the key is the framework's own constant.
    let key = unsafe { kAXTrustedCheckOptionPrompt };
    let options = CFDictionary::from_slices(&[key], &[CFBoolean::new(true)]);
    // SAFETY: a dictionary of the one documented option, a CFString key and a CFBoolean value.
    unsafe { AXIsProcessTrustedWithOptions(Some(options.as_opaque())) }
}

/// Whether this process may capture the screen. Never prompts.
pub(super) fn screen_recording() -> bool {
    CGPreflightScreenCaptureAccess()
}

/// Ask for screen capture: the first call per process shows macOS's prompt; the person grants it in
/// System Settings, and the app must start again before captures see other apps.
pub(super) fn request_screen_recording() -> bool {
    CGRequestScreenCaptureAccess()
}

/// The main bundle's identifier, when this process runs from an app bundle.
pub(super) fn bundle_id() -> Option<String> {
    let bundle = NSBundle::mainBundle();
    bundle.bundleIdentifier().map(|id| id.to_string())
}

/// Open a System Settings pane by its URL.
pub(super) fn open(url: &str) -> Result<(), Error> {
    let failed = || Error::new(ErrorCode::IoError, format!("macOS did not open {url}"));
    let url = NSURL::URLWithString(&NSString::from_str(url)).ok_or_else(failed)?;
    if NSWorkspace::sharedWorkspace().openURL(&url) {
        Ok(())
    } else {
        Err(failed())
    }
}
