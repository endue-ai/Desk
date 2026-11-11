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

use cef::*;

const ASKS: &str = include_str!("frame_asks.js");

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
