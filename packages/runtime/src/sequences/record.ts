/**
 * Recording a key sequence in Settings › Keyboard (ADR 0118), as plain data. By default it reads a
 * key as Emacs does: a chord that is a prefix of keys in force waits for the next one, any other ends
 * the key at once, so one chord commits as it always did. With "several keys in a row" on, chords are
 * added until Enter. Either way Backspace takes the last one back and Escape cancels. The first chord
 * needs Meta, Control or Alt (or is a function key) so typing never runs a command; a key after a
 * prefix may be plain. Enter, Backspace and Escape alone are the recorder's own keys, so a sequence
 * that uses them is written in keys.yaml by hand.
 */
import { comboOf, isChorded, type KeyLike, MODIFIER_KEYS } from "./chord";
import { MAX_SEQUENCE } from "./parse";

export type RecordStep =
  /** Nothing to do: a modifier alone, a key still held, Enter with nothing recorded. */
  | { kind: "ignore" }
  | { kind: "cancel" }
  /** The first chord needs a modifier. */
  | { kind: "invalid" }
  /** The chords recorded so far changed; more may follow. */
  | { kind: "chords"; chords: string[] }
  | { kind: "save"; sequence: string };

export interface RecordMode {
  /** Add chords until Enter, even where no key in force continues them. */
  several: boolean;
  /** Whether canonical chords are a prefix of some key in force. */
  isPrefix(chords: string[]): boolean;
}

const FUNCTION_KEY = /^F([1-9]|1[0-9]|2[0-4])$/;
const bare = (event: KeyLike) =>
  !(event.metaKey || event.ctrlKey || event.altKey || event.shiftKey);

/** What one key press does to the chords recorded so far. */
export function recordKey(
  chords: readonly string[],
  event: KeyLike,
  mode: RecordMode = { several: true, isPrefix: () => false },
): RecordStep {
  if (MODIFIER_KEYS.has(event.key) || event.repeat) return { kind: "ignore" };
  if (bare(event) && event.key === "Escape") return { kind: "cancel" };
  if (bare(event) && event.key === "Enter")
    return chords.length ? { kind: "save", sequence: chords.join(" ") } : { kind: "ignore" };
  if (bare(event) && event.key === "Backspace")
    return chords.length ? { kind: "chords", chords: chords.slice(0, -1) } : { kind: "ignore" };
  const chord = comboOf(event);
  if (!chords.length && !isChorded(chord) && !FUNCTION_KEY.test(event.key))
    return { kind: "invalid" };
  const next = [...chords, chord];
  if (next.join(" ").length > MAX_SEQUENCE) return { kind: "ignore" };
  if (mode.several || mode.isPrefix(next)) return { kind: "chords", chords: next };
  return { kind: "save", sequence: next.join(" ") };
}
