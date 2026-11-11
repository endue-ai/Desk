//! A resting surface's page asks for frames (#134). The desk sends a long-idle surface no begin frame
//! (`frames.rs`), and CEF says nothing of what a renderer waits for, so before a frame's scripts run
//! its page gets `frame_asks.js`: whatever may need a frame there (a `requestAnimationFrame`, a
//! change to the document, an animation, media, a load, a font, a draw on a canvas) wants one, and
//! while a want is unmet, a frame must come within two desk frames of it or of the last frame; when
//! none does, the page calls `__deskNative.wake()` (the process message `renderer::WAKE`), and
//! again a second on while none came. So a page waiting on a frame asks until one comes, wherever
//! its frames stopped (`frame_asks.test.ts`). The browser's client tells the clock
//! (`frames::asked`), which gives the surface its next desk frames. Every frame's page gets it: a
//! frame of another site in a surface paints in that surface. A windowed browser's frames come
//! anyway, so its pages never ask.

use std::time::Duration;

use cef::*;

const ASKS: &str = include_str!("frame_asks.js");

/// A `desk.wake` from `frame` of `browser` (`renderer::WAKE`): the clock gives its surface frames;
/// how long the page waited counts only from its main frame (#157, `stall.rs`): another site's frame
/// in it may be one Chromium throttles out of sight, which asks for frames it does not get.
pub fn heard(browser: &Browser, frame: &Frame, message: &ProcessMessage) {
    let waited = (frame.is_main() == 1).then(|| {
        let ms = message.argument_list().map_or(0, |list| list.int(0));
        Duration::from_millis(u64::try_from(ms).unwrap_or_default())
    });
    super::frames::asked(browser.identifier(), waited);
}

/// Run the script in `context`, which `__deskNative` is in already.
pub fn install(context: &V8Context) {
    let mut result = None;
    let mut exception = None;
    let ok = context.eval(
        Some(&ASKS.into()),
        Some(&"desk-shell://frame-asks.js".into()),
        1,
        Some(&mut result),
        Some(&mut exception),
    );
    if ok != 1 {
        let why = exception
            .map(|e| CefString::from(&e.message()).to_string())
            .unwrap_or_default();
        eprintln!("endue Desk: a page cannot ask for frames ({why})");
    }
}
