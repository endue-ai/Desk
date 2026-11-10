//! The shell keymap, in Rust (#56): `packages/runtime/src/keymap.ts` and `input.ts` over
//! `sequences/{chord,parse,reserved,conflicts,router}.ts` (ADR 0118), so the compositor knows before
//! it delivers a key whether the desk's keymap takes it. The bindings come from the runtime as the
//! entries it resolves itself (every layer, with its owner); this resolves them by the same
//! precedence (personal > plugin > core default, the later one within a layer) and routes presses
//! through the same pending-prefix router. A key whose command is not registered passes on, as a
//! key of a command that is off does in the runtime.

mod chord;
mod conflicts;
mod parse;
mod reserved;
mod router;

use std::collections::HashSet;

pub use chord::{
    KeyLike, Platform, canonical_chord, combo_of, format_chord, is_chorded, is_modifier_key,
    split_chord,
};
pub use conflicts::{
    Conflict, ConflictKind, KeyEntry, KeyLayer, KeySource, Resolution, Resolved, Severity,
    continuations, layer_of, resolve_bindings,
};
pub use parse::{
    CANCEL_CHORDS, MAX_SEQUENCE, canonical, chords_of, format_chords, format_combo, is_cancel,
    is_prefix, parse_sequence,
};
pub use reserved::{Reserved, reserved_chords, reserved_in};
pub use router::{Outcome, Pressed, SequenceEvent, SequenceRouter};

use serde_json::Value;

/// A binding in force, as `resolveKeymap` lists it.
#[derive(Clone, Debug, PartialEq)]
pub struct Binding {
    pub combo: String,
    pub command: String,
    pub args: Option<Value>,
    pub owner: String,
}

/// The bindings in force for a platform, one per sequence, in sequence order.
pub fn resolve_keymap(entries: &[KeyEntry], platform: Platform) -> Vec<Binding> {
    resolve_bindings(entries, platform)
        .bindings
        .into_iter()
        .map(|r| Binding {
            combo: r.combo,
            command: r.command,
            args: r.args,
            owner: r.owner,
        })
        .collect()
}

/// What the keymap makes of a key press.
#[derive(Clone, Debug, PartialEq)]
pub enum KeyDecision {
    /// A whole sequence whose command is registered: the desk runs it.
    Run {
        command: String,
        args: Option<Value>,
    },
    /// A prefix: the desk waits for the next chord.
    Wait,
    Cancelled,
    /// A continuation of a prefix nothing binds (the desk says so).
    Unbound,
    /// A held chord repeating while the desk waits: ignored.
    Ignored,
    /// A capture (desk.describe) took the sequence.
    Captured(String),
    /// Not the desk's: the key goes on to whoever has the focus.
    PassOn,
}

impl KeyDecision {
    /// Whether the desk took the key.
    pub fn is_desks(&self) -> bool {
        !matches!(self, KeyDecision::PassOn)
    }
}

/// The keymap in force and its pending prefix.
pub struct Keymap {
    platform: Platform,
    resolution: Resolution,
    router: SequenceRouter<usize>,
    /// The commands registered now; `None` until the runtime says, which takes every one.
    known: Option<HashSet<String>>,
}

impl Keymap {
    pub fn new(platform: Platform) -> Keymap {
        Keymap {
            platform,
            resolution: Resolution::default(),
            router: SequenceRouter::default(),
            known: None,
        }
    }

    pub fn platform(&self) -> Platform {
        self.platform
    }

    /// Bind every entry of every layer, resolved; `known` names the commands registered now.
    pub fn apply(&mut self, entries: &[KeyEntry], known: Option<&[String]>) {
        self.resolution = resolve_bindings(entries, self.platform);
        self.router.clear();
        for (i, resolved) in self.resolution.bindings.iter().enumerate() {
            self.router.bind(&resolved.chords, i, None);
        }
        self.set_known(known);
    }

    /// The commands registered now (`None`: every one).
    pub fn set_known(&mut self, known: Option<&[String]>) {
        self.known = known.map(|k| k.iter().cloned().collect());
    }

    /// Bind `key` for `surface` alone, asked before the global keymap while it has the focus (a
    /// view's action keys).
    pub fn bind_surface(&mut self, surface: &str, key: &str, command: &str) {
        let combo = canonical(key, self.platform);
        let chords = chords_of(&combo);
        self.resolution.bindings.push(Resolved {
            combo,
            chords: chords.clone(),
            command: command.to_owned(),
            args: None,
            owner: surface.to_owned(),
            layer: KeyLayer::Plugin,
            index: usize::MAX,
            source: None,
        });
        let at = self.resolution.bindings.len() - 1;
        self.router.bind(&chords, at, Some(surface));
    }

    /// Wait at most `ms` for the next chord of a sequence (0: no limit).
    pub fn set_timeout(&mut self, ms: u64) {
        self.router.set_timeout(ms);
    }

    /// Route one key press at `now` (milliseconds) with `focused` the surface whose keys come first.
    pub fn press(&mut self, key: &KeyLike, focused: Option<&str>, now: u64) -> KeyDecision {
        if is_modifier_key(&key.key) {
            return KeyDecision::PassOn;
        }
        let waiting = !self.router.pending().is_empty() || self.router.capturing();
        if waiting && key.repeat {
            return KeyDecision::Ignored;
        }
        let chord = combo_of(key);
        match self.router.press(&chord, focused, now) {
            Pressed::Run { value, waited } => {
                let resolved = &self.resolution.bindings[value];
                let on = self
                    .known
                    .as_ref()
                    .is_none_or(|known| known.contains(&resolved.command));
                if on {
                    return KeyDecision::Run {
                        command: resolved.command.clone(),
                        args: resolved.args.clone(),
                    };
                }
                if waited {
                    self.router.off(resolved.chords.clone());
                    return KeyDecision::Unbound;
                }
                KeyDecision::PassOn
            }
            Pressed::Wait => KeyDecision::Wait,
            Pressed::Cancelled => KeyDecision::Cancelled,
            Pressed::Unbound => KeyDecision::Unbound,
            Pressed::Captured(sequence) => KeyDecision::Captured(sequence),
            Pressed::NotMine => KeyDecision::PassOn,
        }
    }

    /// Time passed: a prefix past the timeout stops waiting.
    pub fn tick(&mut self, now: u64) {
        self.router.tick(now);
    }

    /// Stop waiting for the next chord (a click elsewhere, the focus leaving).
    pub fn cancel(&mut self) {
        self.router.cancel(Outcome::Cancelled, 0);
    }

    /// Hand the next whole sequence to `KeyDecision::Captured`.
    pub fn capture_next(&mut self) {
        self.router.capture_next();
    }

    pub fn pending(&self) -> &[String] {
        self.router.pending()
    }

    pub fn take_events(&mut self) -> Vec<SequenceEvent> {
        self.router.take_events()
    }

    /// The global bindings in force.
    pub fn bindings(&self) -> &[Resolved] {
        let global = self
            .resolution
            .bindings
            .iter()
            .take_while(|b| b.index != usize::MAX)
            .count();
        &self.resolution.bindings[..global]
    }

    pub fn conflicts(&self) -> &[Conflict] {
        &self.resolution.conflicts
    }

    /// The bindings that continue a pending prefix.
    pub fn continuations<S: AsRef<str>>(&self, prefix: &[S]) -> Vec<&Resolved> {
        continuations(self.bindings(), prefix)
    }

    /// The keys that run `command`, as people read them on this platform: "⌘K ⌘S".
    pub fn keys_for(&self, command: &str) -> Vec<String> {
        self.bindings()
            .iter()
            .filter(|b| b.command == command)
            .map(|b| format_combo(&b.combo, self.platform))
            .collect()
    }
}
