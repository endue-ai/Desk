//! The desk's keys in a window out of the canvas (#235, ADR 0118, ADR 0192). On the canvas the
//! compositor asks the desk's keymap before a plugin's page hears a key (`desk-compositor`'s
//! `input/keys.rs`): a chord with Meta, Control or Alt that the keymap binds, and every key while a
//! sequence waits for its next chord, is the desk's, and the runtime hears it from the surface as
//! `desk:key`, so it runs with the surface's keys first. An app window's browser hears its keys
//! itself; CEF asks this first (`OnPreKeyEvent`) with the same keymap, the runtime's as it last
//! reported it (`report`), and a key the desk takes never reaches the page, nor does its character
//! or its release. Each window keeps its own sequence. Every other key goes to the page as in any
//! browser, and the SDK still hands on the chords the plugin leaves, as on the canvas. A key whose
//! command lands on the desk (⌘K's palette is in its page, Control+Tab may put a window of the
//! canvas in use) brings the desk's window forward (`lately`, `compositor_window`).

use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use cef::sys::cef_event_flags_t as F;
use cef::{KeyEvent, KeyEventType};
use desk_compositor::input::keymap::{
    KeyEntry, KeyLike, Keymap, Platform, combo_of, is_chorded, is_modifier_key,
};
use serde_json::{Value, json};

use crate::web_host::key_codes;

/// The runtime's keymap as it last reported it, for every app window.
#[derive(Default)]
struct Reported {
    revision: u64,
    platform: Option<Platform>,
    entries: Vec<KeyEntry>,
    known: Option<Vec<String>>,
    timeout: u64,
}

fn reported() -> &'static Mutex<Reported> {
    static REPORTED: OnceLock<Mutex<Reported>> = OnceLock::new();
    REPORTED.get_or_init(Mutex::default)
}

/// The runtime reported its keymap (`compositor_window/input.rs`): each app window reads it again
/// at its next key.
pub fn report(platform: Platform, entries: &[KeyEntry], known: Option<&[String]>, timeout: u64) {
    let mut r = reported().lock().unwrap_or_else(|e| e.into_inner());
    r.revision += 1;
    r.platform = Some(platform);
    r.entries = entries.to_vec();
    r.known = known.map(<[String]>::to_vec);
    r.timeout = timeout;
}

/// How long after an app window handed the desk a key what the desk does next answers it.
const ANSWERS: Duration = Duration::from_secs(1);

fn handed() -> &'static Mutex<Option<Instant>> {
    static HANDED: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();
    HANDED.get_or_init(Mutex::default)
}

/// Whether an app window handed the desk a key a moment ago: what the desk's page does with its
/// focus, or the window it puts in use, answers that key.
pub fn lately() -> bool {
    let handed = handed().lock().unwrap_or_else(|e| e.into_inner());
    handed.is_some_and(|at| at.elapsed() < ANSWERS)
}

/// One app window's keymap: the runtime's, with this window's own sequence.
pub struct Keys {
    revision: u64,
    keymap: Keymap,
    /// The keys whose press the desk took, by CEF's native key code: their character and release
    /// are the desk's too.
    taken: HashSet<i32>,
    start: Instant,
}

impl Default for Keys {
    fn default() -> Keys {
        Keys {
            revision: 0,
            keymap: Keymap::new(Platform::current()),
            taken: HashSet::new(),
            start: Instant::now(),
        }
    }
}

impl Keys {
    fn refresh(&mut self) {
        let r = reported().lock().unwrap_or_else(|e| e.into_inner());
        if r.revision == self.revision {
            return;
        }
        self.revision = r.revision;
        let platform = r.platform.unwrap_or_else(Platform::current);
        if platform != self.keymap.platform() {
            self.keymap = Keymap::new(platform);
        }
        self.keymap.apply(&r.entries, r.known.as_deref());
        self.keymap.set_timeout(r.timeout);
    }

    /// CEF's key `event` in the window of surface `surface`: the `desk:key` the runtime hears from
    /// it when the desk takes it, and whether the page must not hear it (the press, or the
    /// character or release of one the desk took).
    pub fn event(&mut self, event: &KeyEvent, surface: &str) -> (bool, Option<Value>) {
        let native = event.native_key_code;
        match event.type_ {
            KeyEventType::RAWKEYDOWN | KeyEventType::KEYDOWN => {
                let like = like_of(event);
                if self.press(&like, surface) {
                    self.taken.insert(native);
                    *handed().lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
                    return (true, Some(desk_key(&like)));
                }
                (false, None)
            }
            KeyEventType::CHAR => (self.taken.contains(&native), None),
            KeyEventType::KEYUP => (self.taken.remove(&native), None),
            _ => (false, None),
        }
    }

    /// Whether the desk's keymap takes press `like` while surface `surface` has the keys.
    pub fn press(&mut self, like: &KeyLike, surface: &str) -> bool {
        self.refresh();
        let waiting = !self.keymap.pending().is_empty();
        if !waiting && (is_modifier_key(&like.key) || !is_chorded(&combo_of(like))) {
            return false;
        }
        let now = u64::try_from(self.start.elapsed().as_millis()).unwrap_or(u64::MAX);
        self.keymap.tick(now);
        self.keymap.press(like, Some(surface), now).is_desks()
    }
}

/// What the runtime hears of a key the desk took, as `compositor_window/input.rs` sends it.
fn desk_key(key: &KeyLike) -> Value {
    json!({ "type": "desk:key", "key": {
        "key": key.key, "code": key.code, "metaKey": key.meta, "ctrlKey": key.ctrl,
        "altKey": key.alt, "shiftKey": key.shift, "repeat": key.repeat } })
}

/// CEF's key `event` as the keymap reads it: the DOM's `key` and `code`, and the modifiers.
pub fn like_of(event: &KeyEvent) -> KeyLike {
    let held = |f: F| event.modifiers & f.0 != 0;
    let code = key_codes::code_of(event.native_key_code, event.windows_key_code);
    let typed = char::from_u32(u32::from(event.unmodified_character))
        .filter(|c| !c.is_control() && !('\u{f700}'..='\u{f8ff}').contains(c));
    let key = code
        .and_then(key_codes::named)
        .map(str::to_owned)
        .or_else(|| typed.map(String::from))
        .or_else(|| code.and_then(key_codes::unmodified).map(String::from))
        .unwrap_or_else(|| "Unidentified".to_owned());
    KeyLike {
        key,
        code: code.map(str::to_owned),
        meta: held(F::EVENTFLAG_COMMAND_DOWN),
        ctrl: held(F::EVENTFLAG_CONTROL_DOWN),
        alt: held(F::EVENTFLAG_ALT_DOWN),
        shift: held(F::EVENTFLAG_SHIFT_DOWN),
        repeat: held(F::EVENTFLAG_IS_REPEAT),
    }
}

#[cfg(test)]
#[path = "keys_tests.rs"]
mod tests;
