//! A browser's begin frame in flight (#339, ADR 0261). Chromium's display takes one external begin
//! frame at a time: one sent before the last has ended is a bad message, and the GPU process that
//! gets it exits ("Got overlapping IssueExternalBeginFrame"), which stopped the desk's page and every
//! surface with it on a start-up that opened six files. CEF says nothing when a frame ends, so the
//! clock holds a browser's next begin frame until what it can see says the last one ended: its page
//! painted since (a frame with something to draw ends with its paint), or one desk frame (`FRAME`)
//! passed (a frame with nothing to draw ends at its deadline, a desk frame on: ADR 0231).

use std::time::Instant;

use super::FRAME;

/// When a browser was last sent a begin frame, and the paints it had then.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Flight {
    sent: Option<(Instant, u64)>,
}

impl Flight {
    /// Until when the begin frame sent last is still out at `now`, its page having painted `paints`
    /// frames: `None` once it ended, or when none was sent.
    pub fn out(&self, now: Instant, paints: u64) -> Option<Instant> {
        let (at, then) = self.sent?;
        let until = at + FRAME;
        (paints <= then && now < until).then_some(until)
    }

    /// A begin frame went to the browser at `now`, its page having painted `paints` frames.
    pub fn sent(&mut self, now: Instant, paints: u64) {
        self.sent = Some((now, paints));
    }

    /// A new browser, or one loaded again: nothing of the old one is out.
    pub fn restart(&mut self) {
        self.sent = None;
    }
}
