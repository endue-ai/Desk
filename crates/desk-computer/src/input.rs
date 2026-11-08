//! Synthesized input, planned as the low-level events a `Computer` posts one by one: a click is a
//! move, a press and a release; typed text is key events carrying up to `MAX_UNITS` UTF-16 code
//! units each (`CGEventKeyboardSetUnicodeString`), cut on grapheme boundaries so no chunk splits a
//! Hangul syllable, a combining mark or an emoji; line breaks and tabs are the Return and Tab keys.
//! Planning is pure, so `Control` validates an action before the guard sees it and the stop flag
//! and rate limit act between events.

use unicode_segmentation::UnicodeSegmentation;

use crate::keys::{Chord, Key, Modifiers};
use crate::{Error, Point, invalid};

/// The most UTF-16 code units one key event carries; `CGEventKeyboardSetUnicodeString` drops the
/// rest beyond about 20.
pub const MAX_UNITS: usize = 20;
/// The most characters one `Action::Text` types.
pub const MAX_TEXT_CHARS: usize = 10_000;
/// The most lines one scroll moves, either way.
pub const MAX_SCROLL_LINES: i32 = 100;
/// A drag moves in steps of about this many points, between 2 and `MAX_DRAG_STEPS` of them.
pub const DRAG_STEP: f64 = 16.0;
pub const MAX_DRAG_STEPS: usize = 32;

/// A mouse button.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub enum Button {
    #[default]
    Left,
    Right,
    Middle,
}

impl Button {
    pub fn name(self) -> &'static str {
        match self {
            Button::Left => "left",
            Button::Right => "right",
            Button::Middle => "middle",
        }
    }
}

/// One mouse action.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Mouse {
    /// Move the pointer.
    Move { to: Point },
    /// Click `count` times (1 to 3: single, double, triple) at a point.
    Click {
        at: Point,
        button: Button,
        count: u8,
    },
    /// Press the left button at `from`, move to `to` and release.
    Drag { from: Point, to: Point },
    /// Scroll by lines at a point (or where the pointer is): `dy` > 0 toward the end of the
    /// document (down), `dx` > 0 to the right.
    Scroll { at: Option<Point>, dx: i32, dy: i32 },
}

/// One low-level input event: what a `Computer` posts.
#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    Move {
        to: Point,
    },
    /// A button press; `clicks` is the click count (2 in a double click's second press).
    Down {
        at: Point,
        button: Button,
        clicks: u8,
    },
    Up {
        at: Point,
        button: Button,
        clicks: u8,
    },
    /// A move with the button held.
    Drag {
        to: Point,
        button: Button,
    },
    /// Lines, signed as in `Mouse::Scroll`.
    Scroll {
        dx: i32,
        dy: i32,
    },
    /// A key pressed with `modifiers` held.
    KeyDown {
        key: Key,
        modifiers: Modifiers,
    },
    KeyUp {
        key: Key,
        modifiers: Modifiers,
    },
    /// One chunk of text, at most `MAX_UNITS` UTF-16 code units, typed as one key press.
    Text {
        text: String,
    },
}

impl Event {
    /// The event that undoes a press this event made, if it made one: a key or button left held
    /// when an action stops half-way is released with it.
    pub fn release(&self) -> Option<Event> {
        match self {
            Event::Down { at, button, clicks } => Some(Event::Up {
                at: *at,
                button: *button,
                clicks: *clicks,
            }),
            Event::KeyDown { key, .. } => Some(Event::KeyUp {
                key: *key,
                modifiers: Modifiers::default(),
            }),
            _ => None,
        }
    }

    /// Whether this event releases what `press` pressed.
    pub fn releases(&self, press: &Event) -> bool {
        match (press, self) {
            (Event::Down { button: a, .. }, Event::Up { button: b, .. }) => a == b,
            (Event::KeyDown { key: a, .. }, Event::KeyUp { key: b, .. }) => a == b,
            _ => false,
        }
    }
}

/// The events of a mouse action. `invalid_params` for a point that is not finite, a click count
/// outside 1 to 3, or a scroll of nothing or of more than `MAX_SCROLL_LINES`.
pub fn plan_mouse(mouse: &Mouse) -> Result<Vec<Event>, Error> {
    let finite = |point: Point| {
        if point.is_finite() {
            Ok(point)
        } else {
            Err(invalid(format!("{point} is not a point on the screen")))
        }
    };
    Ok(match *mouse {
        Mouse::Move { to } => vec![Event::Move { to: finite(to)? }],
        Mouse::Click { at, button, count } => {
            let at = finite(at)?;
            if !(1..=3).contains(&count) {
                return Err(invalid(format!("a click is 1 to 3 presses, not {count}")));
            }
            let mut events = vec![Event::Move { to: at }];
            for clicks in 1..=count {
                events.push(Event::Down { at, button, clicks });
                events.push(Event::Up { at, button, clicks });
            }
            events
        }
        Mouse::Drag { from, to } => {
            let (from, to) = (finite(from)?, finite(to)?);
            let steps = ((from.distance(to) / DRAG_STEP).ceil() as usize).clamp(2, MAX_DRAG_STEPS);
            let button = Button::Left;
            let mut events = vec![
                Event::Move { to: from },
                Event::Down {
                    at: from,
                    button,
                    clicks: 1,
                },
            ];
            for step in 1..=steps {
                let to = from.lerp(to, step as f64 / steps as f64);
                events.push(Event::Drag { to, button });
            }
            events.push(Event::Up {
                at: to,
                button,
                clicks: 1,
            });
            events
        }
        Mouse::Scroll { at, dx, dy } => {
            if (dx == 0 && dy == 0) || dx.abs() > MAX_SCROLL_LINES || dy.abs() > MAX_SCROLL_LINES {
                return Err(invalid(format!(
                    "a scroll moves 1 to {MAX_SCROLL_LINES} lines, not {dx} across and {dy} down"
                )));
            }
            let mut events = Vec::new();
            if let Some(at) = at {
                events.push(Event::Move { to: finite(at)? });
            }
            events.push(Event::Scroll { dx, dy });
            events
        }
    })
}

/// The events of a chord: modifiers pressed in order, the key pressed and released, the modifiers
/// released in reverse. Each event carries the modifiers held at that moment.
pub fn plan_chord(chord: &Chord) -> Vec<Event> {
    let mut held = Modifiers::default();
    let mut events = Vec::new();
    let modifiers = chord.modifiers.keys();
    for key in &modifiers {
        held = held.with(*key, true);
        events.push(Event::KeyDown {
            key: *key,
            modifiers: held,
        });
    }
    events.push(Event::KeyDown {
        key: chord.key,
        modifiers: held.with(chord.key, true),
    });
    events.push(Event::KeyUp {
        key: chord.key,
        modifiers: held,
    });
    for key in modifiers.iter().rev() {
        held = held.with(*key, false);
        events.push(Event::KeyUp {
            key: *key,
            modifiers: held,
        });
    }
    events
}

/// The events that type `text`: chunks of it as `Event::Text`, and Return and Tab presses for line
/// breaks (`\n`, `\r\n`, `\r`) and tabs. `invalid_params` for empty text, more than
/// `MAX_TEXT_CHARS` characters, or other control characters (press those as chords).
pub fn plan_text(text: &str) -> Result<Vec<Event>, Error> {
    if text.is_empty() {
        return Err(invalid("there is no text to type"));
    }
    if text.chars().count() > MAX_TEXT_CHARS {
        return Err(invalid(format!(
            "type at most {MAX_TEXT_CHARS} characters at a time"
        )));
    }
    if let Some(c) = text
        .chars()
        .find(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return Err(invalid(format!(
            "text holds the control character U+{:04X}; press it as a key chord",
            u32::from(c)
        )));
    }
    let mut events = Vec::new();
    let mut run = String::new();
    for grapheme in text.graphemes(true) {
        let key = match grapheme {
            "\n" | "\r\n" | "\r" => Key::Return,
            "\t" => Key::Tab,
            _ => {
                run.push_str(grapheme);
                continue;
            }
        };
        flush(&mut run, &mut events);
        let modifiers = Modifiers::default();
        events.push(Event::KeyDown { key, modifiers });
        events.push(Event::KeyUp { key, modifiers });
    }
    flush(&mut run, &mut events);
    Ok(events)
}

fn flush(run: &mut String, events: &mut Vec<Event>) {
    for text in chunks(run, MAX_UNITS) {
        events.push(Event::Text { text });
    }
    run.clear();
}

/// `text` cut into pieces of at most `max_units` UTF-16 code units (at least 2), only between
/// grapheme clusters, so a piece never splits a surrogate pair, a Hangul syllable in either form, a
/// base and its combining marks, or an emoji sequence. A grapheme longer than `max_units` (rare: a
/// long ZWJ sequence) is cut between its code points. Joined again, the pieces are `text`.
pub fn chunks(text: &str, max_units: usize) -> Vec<String> {
    let max_units = max_units.max(2);
    let mut pieces = Vec::new();
    let mut piece = String::new();
    let mut units = 0;
    for grapheme in text.graphemes(true) {
        let size = grapheme.encode_utf16().count();
        if units + size > max_units && !piece.is_empty() {
            pieces.push(std::mem::take(&mut piece));
            units = 0;
        }
        if size <= max_units {
            piece.push_str(grapheme);
            units += size;
            continue;
        }
        for c in grapheme.chars() {
            if units + c.len_utf16() > max_units {
                pieces.push(std::mem::take(&mut piece));
                units = 0;
            }
            piece.push(c);
            units += c.len_utf16();
        }
    }
    if !piece.is_empty() {
        pieces.push(piece);
    }
    pieces
}
