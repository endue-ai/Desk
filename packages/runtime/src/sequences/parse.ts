/**
 * Key sequences (ADR 0118): one chord, or chords separated by one space, pressed one after another
 * as in Emacs: "Mod+K Mod+S", "Ctrl+X Ctrl+F", "Ctrl+C p f". Every chord but the last is a prefix;
 * a key after a prefix may be plain. A single chord means what it always meant. The grammar is
 * `KeySequence` in specs/plugin/v0/contributes.schema.json.
 */
import { canonicalChord, formatChord, type Platform } from "./chord";

/** The longest key sequence a binding may have, as the schema says. */
export const MAX_SEQUENCE = 256;
/** The chords that cancel a pending prefix (Emacs's C-g, and Escape); they never continue one. */
export const CANCEL_CHORDS: readonly string[] = ["Escape", "Control+G"];

/** One chord as the grammar writes it; the runtime also reads Cmd and Option. */
const CHORD = /^((Mod|Meta|Control|Ctrl|Cmd|Alt|Option|Shift)\+)*([^+\s]+|\+)$/;

export type Parsed = { ok: true; chords: string[] } | { ok: false; problem: string };

/** Read a key sequence as written: its chords, or what is wrong with it. */
export function parseSequence(text: string): Parsed {
  if (text.length === 0) return { ok: false, problem: "a key is one chord or several, not empty" };
  if (text.length > MAX_SEQUENCE)
    return { ok: false, problem: `a key is at most ${MAX_SEQUENCE} characters` };
  if (/[^\S ]/.test(text))
    return { ok: false, problem: "chords are separated by one space, not a tab or a new line" };
  const chords = text.split(" ");
  for (const [i, chord] of chords.entries()) {
    if (chord === "")
      return {
        ok: false,
        problem: `chord ${i + 1} of "${text}" is empty: one space between chords`,
      };
    if (!CHORD.test(chord))
      return { ok: false, problem: `chord ${i + 1} of "${text}" (${chord}) has no key` };
  }
  return { ok: true, chords };
}

/** Whether `text` is a key sequence the grammar allows. */
export function isSequence(text: unknown): text is string {
  return typeof text === "string" && parseSequence(text).ok;
}

/** The chords of a sequence, leniently: any run of white space separates two. */
export function chordsOf(sequence: string): string[] {
  return sequence.trim().split(/\s+/).filter(Boolean);
}

/** "Mod+K Mod+s" → "Meta+K Meta+S" on macOS, "Control+K Control+S" elsewhere. */
export function canonicalSequence(sequence: string, platform: Platform): string {
  const chords = chordsOf(sequence);
  return chords.length
    ? chords.map((chord) => canonicalChord(chord, platform)).join(" ")
    : canonicalChord(sequence, platform);
}

/** Each chord of a canonical sequence as people read it on the platform: ["⌘K", "⌘S"]. */
export function formatChords(sequence: string, platform: Platform): string[] {
  const chords = chordsOf(sequence);
  return (chords.length ? chords : [sequence]).map((chord) => formatChord(chord, platform));
}

/** How a canonical sequence reads: "⌘K ⌘S" on macOS, "Ctrl+K Ctrl+S" elsewhere. */
export function formatSequence(sequence: string, platform: Platform): string {
  return formatChords(sequence, platform).join(" ");
}

/** Whether `prefix` is a proper prefix of `chords`: every chord of it, then more. */
export function isPrefix(prefix: readonly string[], chords: readonly string[]): boolean {
  return prefix.length < chords.length && prefix.every((chord, i) => chords[i] === chord);
}

/** Whether a chord cancels a pending prefix. */
export const isCancel = (chord: string): boolean => CANCEL_CHORDS.includes(chord);
