//! Screenshots: ScreenCaptureKit's `SCScreenshotManager` on macOS 14 and later, and
//! `CGWindowListCreateImage` before it, where ScreenCaptureKit has no single-frame capture. The
//! target is resolved through CoreGraphics first, so both paths agree on what a capture covers.

use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2::AnyThread;
use objc2::rc::{Retained, autoreleasepool};
use objc2_core_foundation::{CFRetained, CGPoint, CGRect, CGSize};
use objc2_core_graphics::{
    CGDirectDisplayID, CGDisplayBounds, CGImage, CGMainDisplayID, CGWindowID, CGWindowImageOption,
    CGWindowListOption, kCGNullWindowID,
};
use objc2_foundation::{NSArray, NSError};
use objc2_screen_capture_kit::{
    SCContentFilter, SCScreenshotManager, SCShareableContent, SCStreamConfiguration,
};

use super::{image, screen};
use crate::screen::{Capture, Screenshot, Target, WindowScope};
use crate::{Error, ErrorCode, Rect, invalid, not_found};

/// How long ScreenCaptureKit may take to list content or deliver a frame.
const WAIT: Duration = Duration::from_secs(10);
/// `SCStreamErrorUserDeclined`: the person has not allowed screen capture.
const USER_DECLINED: isize = -3801;

/// What a capture covers: a display (all of it, or a region of it) or one window.
enum Area {
    Display {
        id: CGDirectDisplayID,
        region: Option<Rect>,
    },
    Window(CGWindowID),
}

/// An object handed from ScreenCaptureKit's queue to the waiting thread.
struct Handed<T>(T);

// SAFETY: SCShareableContent and CGImage are immutable once delivered, and only the receiving
// thread touches them after the hand-over.
unsafe impl<T> Send for Handed<T> {}

pub(super) fn screenshot(capture: &Capture) -> Result<Screenshot, Error> {
    let (area, bounds, scale) = resolve(capture.target)?;
    let (width, height) = capture.pixels(bounds, scale)?;
    let image = if objc2::available!(macos = 14.0) {
        modern(&area, bounds, width, height)?
    } else {
        legacy(&area, bounds)?
    };
    let pixels = image::rgba(&image, width, height)?;
    Screenshot::from_rgba(width, height, &pixels, bounds)
}

/// The area, its bounds in global points and the pixels per point of the display it is on.
fn resolve(target: Target) -> Result<(Area, Rect, f64), Error> {
    let displays = screen::display_ids()?;
    let display_of = |id: CGDirectDisplayID| (screen::rect(CGDisplayBounds(id)), screen::scale(id));
    match target {
        Target::MainDisplay => {
            let id = CGMainDisplayID();
            let (bounds, scale) = display_of(id);
            Ok((Area::Display { id, region: None }, bounds, scale))
        }
        Target::Display(id) => {
            if !displays.contains(&id) {
                return Err(not_found(format!("there is no active display {id}")));
            }
            let (bounds, scale) = display_of(id);
            Ok((Area::Display { id, region: None }, bounds, scale))
        }
        Target::Window(id) => {
            let window = screen::windows(WindowScope::All, false)?
                .into_iter()
                .find(|w| w.id == id)
                .ok_or_else(|| not_found(format!("there is no window {id}")))?;
            let scale = nearest(&displays, window.bounds).map_or(1.0, |(_, _, scale)| scale);
            Ok((Area::Window(id), window.bounds, scale))
        }
        Target::Region(region) => {
            if !region.is_usable() {
                return Err(invalid(format!("{region} is not an area to capture")));
            }
            let (id, display, scale) = nearest(&displays, region)
                .ok_or_else(|| invalid(format!("{region} is outside every display")))?;
            let x = region.x.max(display.x);
            let y = region.y.max(display.y);
            let clipped = Rect::new(
                x,
                y,
                (region.x + region.width).min(display.x + display.width) - x,
                (region.y + region.height).min(display.y + display.height) - y,
            );
            let area = Area::Display {
                id,
                region: Some(clipped),
            };
            Ok((area, clipped, scale))
        }
    }
}

/// The display `area` overlaps most, if it overlaps any.
fn nearest(displays: &[CGDirectDisplayID], area: Rect) -> Option<(CGDirectDisplayID, Rect, f64)> {
    displays
        .iter()
        .map(|&id| (id, screen::rect(CGDisplayBounds(id))))
        .filter(|(_, bounds)| bounds.overlap(area) > 0.0)
        .max_by(|a, b| a.1.overlap(area).total_cmp(&b.1.overlap(area)))
        .map(|(id, bounds)| (id, bounds, screen::scale(id)))
}

fn cg_rect(rect: Rect) -> CGRect {
    CGRect::new(
        CGPoint::new(rect.x, rect.y),
        CGSize::new(rect.width, rect.height),
    )
}

fn failure(what: &str, error: Option<&NSError>) -> Error {
    let Some(error) = error else {
        return Error::new(
            ErrorCode::IoError,
            format!("ScreenCaptureKit: {what} failed"),
        );
    };
    let declined =
        error.code() == USER_DECLINED && error.domain().to_string().contains("ScreenCaptureKit");
    let code = if declined {
        ErrorCode::PermissionDenied
    } else {
        ErrorCode::IoError
    };
    Error::new(
        code,
        format!("ScreenCaptureKit: {what}: {}", error.localizedDescription()),
    )
}

/// Wait for one answer from a completion handler.
fn wait<T>(receiver: &mpsc::Receiver<Result<Handed<T>, Error>>, what: &str) -> Result<T, Error> {
    match receiver.recv_timeout(WAIT) {
        Ok(answer) => answer.map(|Handed(value)| value),
        Err(_) => Err(Error::new(
            ErrorCode::Timeout,
            format!("ScreenCaptureKit did not answer the {what} in {WAIT:?}"),
        )),
    }
}

fn modern(
    area: &Area,
    bounds: Rect,
    width: u32,
    height: u32,
) -> Result<CFRetained<CGImage>, Error> {
    let (sender, receiver) = mpsc::channel();
    let listed = RcBlock::new(
        move |content: *mut SCShareableContent, error: *mut NSError| {
            // SAFETY: ScreenCaptureKit passes a live content object or nil, and nil or a live error.
            let (content, error) = unsafe { (Retained::retain(content), error.as_ref()) };
            let _ = sender.send(
                content
                    .map(Handed)
                    .ok_or_else(|| failure("listing content", error)),
            );
        },
    );
    // SAFETY: the block has the handler's signature; ScreenCaptureKit copies it and calls it once.
    unsafe {
        SCShareableContent::getShareableContentExcludingDesktopWindows_onScreenWindowsOnly_completionHandler(
            true, false, &listed,
        );
    }
    let content = wait(&receiver, "content list")?;
    let filter = autoreleasepool(|_| filter(&content, area))?;
    // SAFETY: a fresh configuration; sizes in pixels, the source rect in the display's points.
    let config = unsafe {
        let config = SCStreamConfiguration::new();
        config.setWidth(width as usize);
        config.setHeight(height as usize);
        config.setShowsCursor(false);
        if let Area::Display {
            id,
            region: Some(region),
        } = area
        {
            let display = screen::rect(CGDisplayBounds(*id));
            let local = Rect::new(
                region.x - display.x,
                region.y - display.y,
                bounds.width,
                bounds.height,
            );
            config.setSourceRect(cg_rect(local));
        }
        config
    };
    let (sender, receiver) = mpsc::channel();
    let captured = RcBlock::new(move |image: *mut CGImage, error: *mut NSError| {
        // SAFETY: a live CGImage or null, retained before the handler returns; nil or a live error.
        let image = std::ptr::NonNull::new(image).map(|p| unsafe { CFRetained::retain(p) });
        let error = unsafe { error.as_ref() };
        let _ = sender.send(
            image
                .map(Handed)
                .ok_or_else(|| failure("the capture", error)),
        );
    });
    // SAFETY: filter and configuration are live; the block has the handler's signature.
    unsafe {
        SCScreenshotManager::captureImageWithFilter_configuration_completionHandler(
            &filter,
            &config,
            Some(&*captured),
        );
    }
    wait(&receiver, "screenshot")
}

fn filter(content: &SCShareableContent, area: &Area) -> Result<Retained<SCContentFilter>, Error> {
    // SAFETY: getters of delivered content, and filters made from its own displays and windows.
    unsafe {
        match area {
            Area::Display { id, .. } => {
                let display = content
                    .displays()
                    .iter()
                    .find(|d| d.displayID() == *id)
                    .ok_or_else(|| not_found(format!("ScreenCaptureKit has no display {id}")))?;
                Ok(SCContentFilter::initWithDisplay_excludingWindows(
                    SCContentFilter::alloc(),
                    &display,
                    &NSArray::new(),
                ))
            }
            Area::Window(id) => {
                let window = content
                    .windows()
                    .iter()
                    .find(|w| w.windowID() == *id)
                    .ok_or_else(|| not_found(format!("ScreenCaptureKit has no window {id}")))?;
                Ok(SCContentFilter::initWithDesktopIndependentWindow(
                    SCContentFilter::alloc(),
                    &window,
                ))
            }
        }
    }
}

/// Before macOS 14: the window server's image of the area, at the display's best resolution.
#[allow(deprecated)]
fn legacy(area: &Area, bounds: Rect) -> Result<CFRetained<CGImage>, Error> {
    let best = CGWindowImageOption::BestResolution;
    let image = match area {
        Area::Display { .. } => objc2_core_graphics::CGWindowListCreateImage(
            cg_rect(bounds),
            CGWindowListOption::OptionOnScreenOnly,
            kCGNullWindowID,
            best,
        ),
        Area::Window(id) => objc2_core_graphics::CGWindowListCreateImage(
            cg_rect(bounds),
            CGWindowListOption::OptionIncludingWindow,
            *id,
            best | CGWindowImageOption::BoundsIgnoreFraming,
        ),
    };
    let image = image
        .ok_or_else(|| Error::new(ErrorCode::IoError, "the window server returned no image"))?;
    if image::size(&image).0 == 0 {
        return Err(Error::new(
            ErrorCode::IoError,
            "the window server returned an empty image",
        ));
    }
    Ok(image)
}
