//! Which plugin lost its renderer (#44). Every plugin surface is an off-screen browser of its own
//! (#52), so its `OnRenderProcessTerminated` names it: the compositor window turns the surface's
//! `died` into `desk://frame-crashed` for its plugin, and the runtime recovers the window. Stage 1's
//! windowed desk watched the main browser's frame targets over DevTools instead; that watch went
//! with it (#83).

/// The event the page hears, with `{ plugin }`.
pub const CRASHED: &str = "desk://frame-crashed";
