// An unsaved text edit as the one splice that turns the saved text into it, for openers whose state
// must fit the 64 KiB the desk keeps across a sleep (keepFiles, ADR 0070): typing in a 100 KB note
// is a few bytes as a change, not 100 KB of text. The change carries a fingerprint of the text it was
// made from, so it is applied only to that text: a file that changed on disk meanwhile is refused.

/** The splice: `saved.slice(0, from) + put + saved.slice(to)`, from a text of `size` with `sum`. */
export interface TextChange {
  from: number;
  to: number;
  put: string;
  size: number;
  sum: string;
}

/** Two 32-bit hashes of the UTF-16 code units (FNV-1a and djb2), as 16 hex digits. */
export function textSum(text: string): string {
  let fnv = 0x811c9dc5;
  let djb = 5381;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    fnv = Math.imul(fnv ^ unit, 0x01000193) >>> 0;
    djb = (Math.imul(djb, 33) ^ unit) >>> 0;
  }
  return fnv.toString(16).padStart(8, "0") + djb.toString(16).padStart(8, "0");
}

const high = (code: number) => code >= 0xd800 && code <= 0xdbff;
const low = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** The change from `saved` to `text`: what they share at both ends is left out. */
export function textChange(saved: string, text: string): TextChange {
  const shortest = Math.min(saved.length, text.length);
  let from = 0;
  while (from < shortest && saved.charCodeAt(from) === text.charCodeAt(from)) from++;
  // Never between the halves of a surrogate pair, so `put` is whole characters.
  if (from > 0 && high(saved.charCodeAt(from - 1))) from--;
  let tail = 0;
  while (
    tail < shortest - from &&
    saved.charCodeAt(saved.length - 1 - tail) === text.charCodeAt(text.length - 1 - tail)
  )
    tail++;
  if (tail > 0 && low(saved.charCodeAt(saved.length - tail))) tail--;
  return {
    from,
    to: saved.length - tail,
    put: text.slice(from, text.length - tail),
    size: saved.length,
    sum: textSum(saved),
  };
}

const isIndex = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/** Whether `value` reads as a TextChange (one kept by another version may not). */
export function isTextChange(value: unknown): value is TextChange {
  const change = value as Partial<TextChange> | null;
  return (
    typeof change === "object" &&
    change !== null &&
    isIndex(change.from) &&
    isIndex(change.to) &&
    isIndex(change.size) &&
    change.from <= change.to &&
    change.to <= change.size &&
    typeof change.put === "string" &&
    typeof change.sum === "string"
  );
}

/**
 * The edited text again from `saved` and the change made from it; undefined when `saved` is not the
 * text the change was made from (the file changed meanwhile) or the change does not read as one.
 */
export function applyTextChange(saved: string, change: unknown): string | undefined {
  if (!isTextChange(change)) return undefined;
  if (saved.length !== change.size || textSum(saved) !== change.sum) return undefined;
  return saved.slice(0, change.from) + change.put + saved.slice(change.to);
}
