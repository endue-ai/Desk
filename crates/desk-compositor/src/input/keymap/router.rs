//! The pending-prefix router (ADR 0118, `sequences/router.ts`): bound sequences in a trie per scope
//! (the global keymap and each surface's), and the prefix pressed so far. A chord that starts or
//! continues a prefix waits for the next; Escape and Ctrl+G cancel; an unbound continuation ends the
//! wait and is said so. The wait has no time limit unless one is set (desk.keys.sequence-timeout).
//! What a binding holds is the caller's `T`; time is the caller's milliseconds.

use std::collections::HashMap;

use super::parse::is_cancel;

struct Node<T> {
    value: Option<T>,
    children: HashMap<String, Node<T>>,
}

impl<T> Default for Node<T> {
    fn default() -> Self {
        Node {
            value: None,
            children: HashMap::new(),
        }
    }
}

impl<T> Node<T> {
    fn leads(&self) -> bool {
        self.value.is_some() || !self.children.is_empty()
    }
}

/// How a wait for the next chord ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    Ran,
    Off,
    Unbound,
    Cancelled,
    Timeout,
    Captured,
}

/// Prefixes starting, growing and ending, for the which-key overlay and the status area.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SequenceEvent {
    Pending {
        chords: Vec<String>,
        capturing: bool,
    },
    Done {
        chords: Vec<String>,
        outcome: Outcome,
    },
}

/// What one chord did.
#[derive(Clone, Debug, PartialEq)]
pub enum Pressed<T> {
    /// A whole sequence: run its binding.
    Run { value: T, waited: bool },
    /// A prefix: the router waits for the next chord.
    Wait,
    /// The wait was cancelled (Escape, Ctrl+G).
    Cancelled,
    /// A continuation nothing binds: the wait ended.
    Unbound,
    /// A capture took the whole sequence.
    Captured(String),
    /// Bound nowhere and nothing waited: the key is not the router's.
    NotMine,
}

pub struct SequenceRouter<T> {
    global: Node<T>,
    surfaces: HashMap<String, Node<T>>,
    pending: Vec<String>,
    scope: Option<String>,
    capturing: bool,
    timeout_ms: u64,
    deadline: Option<u64>,
    events: Vec<SequenceEvent>,
}

impl<T: Clone> Default for SequenceRouter<T> {
    fn default() -> Self {
        SequenceRouter {
            global: Node::default(),
            surfaces: HashMap::new(),
            pending: Vec::new(),
            scope: None,
            capturing: false,
            timeout_ms: 0,
            deadline: None,
            events: Vec::new(),
        }
    }
}

impl<T: Clone> SequenceRouter<T> {
    /// Bind canonical chords in the global keymap, or `surface`'s.
    pub fn bind(&mut self, chords: &[String], value: T, surface: Option<&str>) {
        let mut at = match surface {
            Some(surface) => self.surfaces.entry(surface.to_owned()).or_default(),
            None => &mut self.global,
        };
        for chord in chords {
            at = at.children.entry(chord.clone()).or_default();
        }
        at.value = Some(value);
    }

    /// Forget every binding, keeping a pending prefix's state out (it is cancelled).
    pub fn clear(&mut self) {
        self.global = Node::default();
        self.surfaces.clear();
        self.cancel(Outcome::Cancelled, 0);
    }

    /// Wait at most `ms` for the next chord (0: as long as it takes).
    pub fn set_timeout(&mut self, ms: u64) {
        self.timeout_ms = ms;
    }

    /// The chords pressed so far of a sequence not complete yet.
    pub fn pending(&self) -> &[String] {
        &self.pending
    }

    pub fn capturing(&self) -> bool {
        self.capturing
    }

    /// Hand the next whole sequence to the caller instead of its binding.
    pub fn capture_next(&mut self) {
        self.capturing = true;
    }

    pub fn take_events(&mut self) -> Vec<SequenceEvent> {
        std::mem::take(&mut self.events)
    }

    /// Route one canonical chord at `now`; `focused` is the surface whose keymap is asked first.
    pub fn press(&mut self, chord: &str, focused: Option<&str>, now: u64) -> Pressed<T> {
        let waiting = !self.pending.is_empty();
        if waiting && is_cancel(chord) {
            return if self.cancel(Outcome::Cancelled, now) {
                Pressed::Captured("Escape".to_owned())
            } else {
                Pressed::Cancelled
            };
        }
        let scope = if waiting {
            self.scope.clone()
        } else {
            focused.map(str::to_owned)
        };
        let mut chords = self.pending.clone();
        chords.push(chord.to_owned());
        let found = self.lookup(&chords, scope.as_deref());
        if let Some((None, true)) = found {
            self.wait(chords, scope, now);
            return Pressed::Wait;
        }
        if self.capturing {
            self.capturing = false;
            if waiting {
                self.end(Outcome::Captured, None);
            }
            return Pressed::Captured(chords.join(" "));
        }
        match found {
            Some((Some(value), _)) => {
                if waiting {
                    self.end(Outcome::Ran, Some(chords));
                }
                Pressed::Run {
                    value,
                    waited: waiting,
                }
            }
            _ if waiting => {
                self.end(Outcome::Unbound, Some(chords));
                Pressed::Unbound
            }
            _ => Pressed::NotMine,
        }
    }

    /// A sequence's command was off: the wait it ended says so.
    pub fn off(&mut self, chords: Vec<String>) {
        self.events.push(SequenceEvent::Done {
            chords,
            outcome: Outcome::Off,
        });
    }

    /// Time passed: a wait past the timeout gives up.
    pub fn tick(&mut self, now: u64) {
        if self.deadline.is_some_and(|deadline| now >= deadline) {
            self.cancel(Outcome::Timeout, now);
        }
    }

    /// Stop waiting, if the router is; returns whether a capture was waiting on the sequence (it
    /// hears "Escape", as when Escape was its first chord).
    pub fn cancel(&mut self, outcome: Outcome, _now: u64) -> bool {
        if self.pending.is_empty() {
            return false;
        }
        let captured = std::mem::take(&mut self.capturing);
        self.end(outcome, None);
        captured
    }

    fn wait(&mut self, chords: Vec<String>, scope: Option<String>, now: u64) {
        self.pending = chords.clone();
        self.scope = scope;
        self.deadline = (self.timeout_ms > 0).then(|| now + self.timeout_ms);
        self.events.push(SequenceEvent::Pending {
            chords,
            capturing: self.capturing,
        });
    }

    fn end(&mut self, outcome: Outcome, chords: Option<Vec<String>>) {
        let chords = chords.unwrap_or_else(|| self.pending.clone());
        self.pending.clear();
        self.scope = None;
        self.deadline = None;
        self.events.push(SequenceEvent::Done { chords, outcome });
    }

    /// The binding at `chords` and whether more continue it, in `scope`'s keymap, else the global.
    fn lookup(&self, chords: &[String], scope: Option<&str>) -> Option<(Option<T>, bool)> {
        let walk = |root: Option<&Node<T>>| {
            let mut at = root?;
            for chord in chords {
                at = at.children.get(chord)?;
            }
            at.leads()
                .then(|| (at.value.clone(), !at.children.is_empty()))
        };
        scope
            .and_then(|s| walk(self.surfaces.get(s)))
            .or_else(|| walk(Some(&self.global)))
    }
}
