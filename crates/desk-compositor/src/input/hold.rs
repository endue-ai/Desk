//! What is typed waits for the page's answer. The router hears a press on the page, or a key the
//! desk's keymap runs, at once; where that leaves the keys is the page's to say a moment later:
//! the talk pill opens its line and focuses it, ⌘K opens the palette and its place takes the
//! page's focus. Until the page says so (`apps/desk/src/compositor-focus.ts`) the keys would still
//! go to the window in use, and what the person typed right away landed there (the terminal ran
//! it). So the keys, the modifiers and the OS input method's text typed in between wait here, in
//! order, and go on when the page answers, when the window loses the OS focus, when a drag starts,
//! or after [`HOLD`] at most, each to the focus at that time as it would have gone then. An answer
//! that gives the keys to a surface the compositor does not draw yet (the palette's, still hidden,
//! whose browser drops every key) waits on until it is drawn, within [`HOLD`] again.

use std::time::{Duration, Instant};

use super::events::Input;
use super::router::{InputRouter, Out};

/// How long what is typed waits at most for the page's answer.
pub const HOLD: Duration = Duration::from_millis(500);

/// The keys waiting for the page's answer, and until when they wait.
#[derive(Debug, Default)]
pub struct Hold {
    until: Option<Instant>,
    held: Vec<Input>,
    /// The page answered: what waits now waits only for the surface with the keys to be drawn.
    answered: bool,
}

impl InputRouter {
    /// A press on the page, or a key the desk ran: what is typed next waits for the page.
    pub(super) fn hold_keys(&mut self, now: Instant) {
        self.hold.until = Some(now + HOLD);
        self.hold.answered = false;
    }

    /// Whether what is typed waits for the page's answer now.
    pub fn holding(&self) -> bool {
        self.hold.until.is_some()
    }

    /// Keep `input` while the keys wait: a key, a change of the modifiers, the IME's text.
    pub(super) fn keep(&mut self, input: &Input) -> bool {
        let typed = matches!(input, Input::Key(_) | Input::Modifiers(_) | Input::Ime(_));
        if !typed || !self.holding() {
            return false;
        }
        self.hold.held.push(input.clone());
        true
    }

    /// The page answered a press or a key: what was typed since goes on, in order, where its
    /// focus left the keys, once the surface there is drawn.
    pub fn page_answered(&mut self, now: Instant) -> Vec<Out> {
        if self.holding() && self.undrawn() {
            self.hold.until = Some(now + HOLD);
            self.hold.answered = true;
            return Vec::new();
        }
        self.let_go(now)
    }

    /// Whether the keys are with a surface the compositor does not draw yet.
    fn undrawn(&self) -> bool {
        let focus = self.focus.as_deref();
        focus
            .is_some_and(|f| Some(f) != self.settings.underlay.as_deref() && !self.targets.shown(f))
    }

    /// What waited goes on now. A key among it that the desk runs makes the rest wait again.
    pub(super) fn let_go(&mut self, now: Instant) -> Vec<Out> {
        self.hold.until = None;
        self.hold.answered = false;
        let mut out = Vec::new();
        let mut held = std::mem::take(&mut self.hold.held).into_iter();
        while let Some(input) = held.next() {
            out.extend(self.keyboard(&input, now));
            if self.holding() {
                self.hold.held.extend(held);
                break;
            }
        }
        out
    }

    /// Time passed: the surface the page gave the keys to is drawn now, or [`HOLD`] passed without
    /// an answer: what waited goes on where the keys are.
    pub(super) fn hold_tick(&mut self, now: Instant) -> Vec<Out> {
        match self.hold.until {
            Some(until) if now >= until => self.let_go(now),
            Some(_) if self.hold.answered && !self.undrawn() => self.let_go(now),
            _ => Vec::new(),
        }
    }
}
