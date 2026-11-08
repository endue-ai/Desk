//! The macOS microphone grant through AVFoundation: `AVCaptureDevice`'s authorization status and
//! request for `AVMediaTypeAudio`. CoreAudio itself never asks; until the grant it delivers silence,
//! so the input refuses to open a device before it.
//!
//! Like `calendar/eventkit.rs`, this module is allowed `unsafe` (the workspace denies it everywhere
//! else): objc2 marks the framework's exported media type and both class methods `unsafe`. Each block
//! reads the constant or calls a method with the arguments AVFoundation documents, and nothing
//! unsafe leaves the module.
//!
//! The app needs `NSMicrophoneUsageDescription` in its Info.plist before it calls `request_access`;
//! without it macOS ends the process. Reading the status never prompts.
#![allow(unsafe_code)]

use std::sync::mpsc;

use block2::RcBlock;
use objc2::runtime::Bool;
use objc2_av_foundation::{AVAuthorizationStatus, AVCaptureDevice, AVMediaType, AVMediaTypeAudio};

use super::Authorization;
use crate::{Error, ErrorCode};

/// The status of the microphone grant. Never prompts.
pub(super) fn authorization() -> Authorization {
    let Some(audio) = audio() else {
        return Authorization::Restricted;
    };
    // SAFETY: a class method that reads the grant for audio, one of the two media types it takes.
    let status = unsafe { AVCaptureDevice::authorizationStatusForMediaType(audio) };
    match status {
        AVAuthorizationStatus::NotDetermined => Authorization::NotDetermined,
        AVAuthorizationStatus::Denied => Authorization::Denied,
        AVAuthorizationStatus::Authorized => Authorization::Authorized,
        // `Restricted`, and any status a later macOS adds: no capture, and asking won't help.
        _ => Authorization::Restricted,
    }
}

/// Show the OS prompt if the person was never asked, and wait for the answer.
pub(super) fn request_access() -> Result<Authorization, Error> {
    let before = authorization();
    if before != Authorization::NotDetermined {
        return Ok(before);
    }
    let Some(audio) = audio() else {
        return Ok(Authorization::Restricted);
    };
    let (sender, receiver) = mpsc::channel::<()>();
    let handler = RcBlock::new(move |_granted: Bool| {
        let _ = sender.send(());
    });
    // SAFETY: audio is a media type the method takes, and `handler` is a live block of the handler's
    // signature, which AVFoundation copies and calls once on a queue of its own.
    unsafe { AVCaptureDevice::requestAccessForMediaType_completionHandler(audio, &handler) };
    drop(handler);
    receiver.recv().map_err(|_| {
        Error::new(
            ErrorCode::IoError,
            "AVFoundation dropped the microphone request without answering",
        )
    })?;
    Ok(authorization())
}

/// `AVMediaTypeAudio`; `None` only if the framework does not export it.
fn audio() -> Option<&'static AVMediaType> {
    // SAFETY: an immutable NSString the framework exports and never frees.
    unsafe { AVMediaTypeAudio }
}
