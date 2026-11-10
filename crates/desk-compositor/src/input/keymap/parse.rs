//! Key sequences (ADR 0118): one chord, or chords separated by one space, pressed one after another
//! as in Emacs ("Mod+K Mod+S", "Ctrl+C p f"), as `packages/runtime/src/sequences/parse.ts` reads
//! them. Every chord but the last is a prefix; a key after a prefix may be plain.

use super::chord::{Platform, canonical_chord, format_chord, split_chord};

/// The longest key sequence a binding may have, as the schema says.
pub const MAX_SEQUENCE: usize = 256;
/// The chords that cancel a pending prefix (Emacs's C-g, and Escape); they never continue one.
pub const CANCEL_CHORDS: [&str; 2] = ["Escape", "Control+G"];

/// Read a key sequence as written: its chords, or what is wrong with it.
pub fn parse_sequence(text: &str) -> Result<Vec<String>, String> {
    if text.is_empty() {
        return Err("a key is one chord or several, not empty".into());
    }
    if text.chars().count() > MAX_SEQUENCE {
        return Err(format!("a key is at most {MAX_SEQUENCE} characters"));
    }
    if text.chars().any(|c| c.is_whitespace() && c != ' ') {
        return Err("chords are separated by one space, not a tab or a new line".into());
    }
    let chords: Vec<String> = text.split(' ').map(str::to_owned).collect();
    for (i, chord) in chords.iter().enumerate() {
        if chord.is_empty() {
            return Err(format!(
                "chord {} of \"{text}\" is empty: one space between chords",
                i + 1
            ));
        }
        if !is_chord(chord) {
            return Err(format!(
                "chord {} of \"{text}\" ({chord}) has no key",
                i + 1
            ));
        }
    }
    Ok(chords)
}

/// One chord as the grammar writes it: modifiers, each followed by `+`, then a key without `+` or
/// white space, or the key `+` itself.
fn is_chord(chord: &str) -> bool {
    let (_, key) = split_chord(chord);
    key == "+" || (!key.is_empty() && !key.contains('+') && !key.contains(char::is_whitespace))
}

/// The chords of a sequence, leniently: any run of white space separates two.
pub fn chords_of(sequence: &str) -> Vec<String> {
    sequence.split_whitespace().map(str::to_owned).collect()
}

/// "Mod+K Mod+s" → "Meta+K Meta+S" on macOS, "Control+K Control+S" elsewhere.
pub fn canonical(sequence: &str, platform: Platform) -> String {
    let chords = chords_of(sequence);
    if chords.is_empty() {
        return canonical_chord(sequence, platform);
    }
    chords
        .iter()
        .map(|chord| canonical_chord(chord, platform))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Each chord of a canonical sequence as people read it on the platform: ["⌘K", "⌘S"].
pub fn format_chords(sequence: &str, platform: Platform) -> Vec<String> {
    let chords = chords_of(sequence);
    let chords = if chords.is_empty() {
        vec![sequence.to_owned()]
    } else {
        chords
    };
    chords
        .iter()
        .map(|chord| format_chord(chord, platform))
        .collect()
}

/// How a canonical sequence reads: "⌘K ⌘S" on macOS, "Ctrl+K Ctrl+S" elsewhere.
pub fn format_combo(sequence: &str, platform: Platform) -> String {
    format_chords(sequence, platform).join(" ")
}

/// Whether `prefix` is a proper prefix of `chords`: every chord of it, then more.
pub fn is_prefix<A: AsRef<str>, B: AsRef<str>>(prefix: &[A], chords: &[B]) -> bool {
    prefix.len() < chords.len()
        && prefix
            .iter()
            .zip(chords)
            .all(|(a, b)| a.as_ref() == b.as_ref())
}

/// Whether a chord cancels a pending prefix.
pub fn is_cancel(chord: &str) -> bool {
    CANCEL_CHORDS.contains(&chord)
}
