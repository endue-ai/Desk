// Byte checks for file plugins that edit (ADR 0071). A `lossless` format serializes an unchanged
// file to the same bytes, and an edit changes only the bytes it must. This file imports nothing,
// touches no DOM and uses only erasable TypeScript, so vitest, a browser and plain Node (type
// stripping) load it alike: `import { assertRoundTrip } from ".../src/testing/round-trip.ts"`.

/** Bytes, or text taken as UTF-8. */
export type BytesLike = Uint8Array | ArrayBuffer | string;

/**
 * Where an edit may change `before`: `length` bytes at byte `offset` (0 inserts there), or the only
 * occurrence of `find`. With `bytes` the span must become exactly those; without, anything.
 */
export type EditSpan =
  | { offset: number; length: number; bytes?: BytesLike }
  | { find: BytesLike; bytes?: BytesLike };

/** One change: before[bs..be) became after[as..ae). */
type Hunk = { bs: number; be: number; as: number; ae: number };
/** A span placed in `before`: [start, end), and what it must become, if anything in particular. */
type Span = { start: number; end: number; bytes: Uint8Array | undefined };

const WINDOW = 16; // bytes in a window
const LEAD = 6; // of them before the difference
const LISTED = 8; // changes listed before "and N more"
const MAX_EDITS = 1_000; // Myers' D past which changes are not listed one by one
const MAX_WORK = 20_000_000; // byte comparisons, likewise
const PREVIEW = 24; // bytes of a change shown as text

const encoder = new TextEncoder();
// Keeps a BOM, so a window shows it.
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

/**
 * Parse `bytes`, serialize the model and fail unless the result is the same bytes. `parse` always
 * gets a fresh `Uint8Array` (a decoder that drops a BOM is caught); `serialize` may return bytes or
 * a string (UTF-8). Returns the model, so a test can edit it next; a promise only when `parse` or
 * `serialize` returns one.
 */
export function assertRoundTrip<P, S extends BytesLike | PromiseLike<BytesLike>>(
  bytes: BytesLike,
  parse: (bytes: Uint8Array) => P,
  serialize: (model: Awaited<P>) => S,
): P extends PromiseLike<infer M> ? Promise<M> : S extends PromiseLike<BytesLike> ? Promise<P> : P {
  const original = toBytes(bytes, "bytes");
  const compare = (model: unknown, out: unknown) => {
    const result = toBytes(out, "serialize's result");
    if (!equalAt(result, 0, original) || result.length !== original.length) {
      fail(roundTripReport(original, result));
    }
    return model;
  };
  const write = (model: unknown) => {
    const out = serialize(model as Awaited<P>);
    return isThenable(out)
      ? Promise.resolve(out).then((o) => compare(model, o))
      : compare(model, out);
  };
  const model = parse(original.slice());
  return (isThenable(model) ? Promise.resolve(model).then(write) : write(model)) as never;
}

/**
 * Fail unless `after` is `before` with each span of `edit` replaced (by its `bytes`, or by
 * anything) and every other byte the same, in order. Offsets count bytes of `before`. The message names the
 * first change outside the spans, windows around it and the changes outside, at most eight.
 */
export function assertMinimalEdit(
  before: BytesLike,
  after: BytesLike,
  edit: EditSpan | readonly EditSpan[],
): void {
  const b = toBytes(before, "before");
  const a = toBytes(after, "after");
  const spans = place(b, edit);
  if (fits(b, a, spans)) return;
  const { hunks, exact } = changes(b, a);
  const lines = [
    `assertMinimalEdit: after is not before with only the allowed edit (${b.length} bytes before, ${a.length} after)`,
    ...spans.map(
      (s) =>
        `allowed: before[${s.start}..${s.end}) ${preview(b.subarray(s.start, s.end))} → ${
          s.bytes ? preview(s.bytes) : "any bytes"
        }`,
    ),
  ];
  const outside = hunks.filter((h) => !spans.some((s) => s.start <= h.bs && h.be <= s.end));
  const [first] = outside;
  if (first) {
    const at = firstOutside(first, spans);
    const there = Math.min(first.as + (at - first.bs), first.ae);
    lines.push(
      `first change outside it at before byte ${at} (${lineOf(b, at)}), after byte ${there}`,
      window("before", b, at),
      window("after", a, there),
      "changed outside it:",
      ...listed(outside, b, a, ["before", "after"]),
    );
    if (!exact) lines.push(TOO_MANY);
    fail(lines.join("\n"));
  }
  // Nothing changed outside the spans, so a span did not become its bytes.
  for (const s of spans) {
    if (!s.bytes) continue;
    const from = toAfter(hunks, s.start, "start");
    const to = toAfter(hunks, s.end, "end");
    const became = a.subarray(from, to);
    if (became.length === s.bytes.length && equalAt(became, 0, s.bytes)) continue;
    const at = from + commonPrefix(became, s.bytes);
    lines.push(
      `before[${s.start}..${s.end}) became ${preview(became)}, not ${preview(s.bytes)} (after[${from}..${to}))`,
      `first difference at after byte ${at} (${lineOf(a, at)})`,
      window("after", a, at),
    );
    fail(lines.join("\n"));
  }
  const at = commonPrefix(b, a);
  lines.push(`first difference at byte ${at} (${lineOf(b, at)})`, window("before", b, at));
  fail([...lines, window("after", a, at)].join("\n"));
}

const TOO_MANY = "(too many changes to list one by one: from the first difference to the last)";

function roundTripReport(original: Uint8Array, result: Uint8Array): string {
  const { hunks, exact } = changes(original, result);
  const first = hunks[0] as Hunk;
  const lines = [
    `assertRoundTrip: serialize(parse(bytes)) is not byte-identical to bytes (${original.length} bytes in, ${result.length} out)`,
    `first difference at byte ${first.bs} (${lineOf(original, first.bs)})`,
    window("bytes", original, first.bs),
    window("result", result, first.as),
    "changed:",
    ...listed(hunks, original, result, ["bytes", "result"]),
  ];
  if (!exact) lines.push(TOO_MANY);
  return lines.join("\n");
}

function fail(message: string): never {
  const error = new Error(message);
  error.name = "AssertionError";
  throw error;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as { then?: unknown } | null)?.then === "function";
}

function toBytes(value: unknown, what: string): Uint8Array {
  if (typeof value === "string") return encoder.encode(value);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  const kind = value === null ? "null" : typeof value;
  throw new TypeError(`${what} is ${kind}, not bytes (a Uint8Array or an ArrayBuffer) or a string`);
}

/** Place each span in `before`, in order; a span that cannot be placed is the test's mistake. */
function place(before: Uint8Array, edit: EditSpan | readonly EditSpan[]): Span[] {
  const list = (Array.isArray(edit) ? edit : [edit]) as readonly EditSpan[];
  const spans = list.map((span): Span => {
    const bytes = span.bytes === undefined ? undefined : toBytes(span.bytes, "a span's bytes");
    if ("find" in span) {
      const find = toBytes(span.find, "find");
      if (find.length === 0) misuse("find is empty: give the bytes the edit replaces");
      const found: number[] = [];
      let i = indexOf(before, find, 0, before.length);
      for (; i >= 0; i = indexOf(before, find, i + 1, before.length)) found.push(i);
      if (found.length === 0) misuse(`find ${preview(find)} does not occur in before`);
      if (found.length > 1) {
        const where = `${found.slice(0, 5).join(", ")}${found.length > 5 ? ", …" : ""}`;
        misuse(
          `find ${preview(find)} occurs ${found.length} times in before (at ${where}): give offset and length`,
        );
      }
      const start = found[0] as number;
      return { start, end: start + find.length, bytes };
    }
    const { offset, length } = span;
    const whole = Number.isInteger(offset) && Number.isInteger(length);
    if (!whole || offset < 0 || length < 0 || offset + length > before.length) {
      misuse(`the span of ${length} bytes at ${offset} is outside before (${before.length} bytes)`);
    }
    return { start: offset, end: offset + length, bytes };
  });
  spans.sort((x, y) => x.start - y.start || x.end - y.end);
  for (let i = 1; i < spans.length; i++) {
    const [p, s] = [spans[i - 1] as Span, spans[i] as Span];
    if (s.start < p.end) {
      misuse(`spans before[${p.start}..${p.end}) and before[${s.start}..${s.end}) overlap`);
    }
  }
  return spans;
}

function misuse(message: string): never {
  throw new RangeError(`assertMinimalEdit: ${message}`);
}

/** Whether `after` is `before` with each span replaced: by its bytes, or by anything. */
function fits(before: Uint8Array, after: Uint8Array, spans: readonly Span[]): boolean {
  // The literal pieces between the spans that may become anything, each made of parts.
  const parts: Uint8Array[][] = [[]];
  let at = 0;
  for (const span of spans) {
    parts.at(-1)?.push(before.subarray(at, span.start));
    if (span.bytes) parts.at(-1)?.push(span.bytes);
    else parts.push([]);
    at = span.end;
  }
  parts.at(-1)?.push(before.subarray(at));
  const pieces = parts.map(concat);
  const first = pieces[0] as Uint8Array;
  const last = pieces.at(-1) as Uint8Array;
  if (pieces.length === 1) return after.length === first.length && equalAt(after, 0, first);
  const end = after.length - last.length;
  if (end < first.length || !equalAt(after, 0, first) || !equalAt(after, end, last)) return false;
  // Leftmost matches in order leave the most room for the pieces after them.
  let from = first.length;
  for (const piece of pieces.slice(1, -1)) {
    const found = indexOf(after, piece, from, end);
    if (found < 0) return false;
    from = found + piece.length;
  }
  return true;
}

/**
 * The changes that turn `b` into `a`: Myers' O(ND) diff between the common prefix and suffix, or
 * one change from the first difference to the last when there are too many to list (`exact` false).
 */
function changes(b: Uint8Array, a: Uint8Array): { hunks: Hunk[]; exact: boolean } {
  const p = commonPrefix(b, a);
  const limit = Math.min(b.length, a.length) - p;
  let q = 0;
  while (q < limit && b[b.length - 1 - q] === a[a.length - 1 - q]) q++;
  const inner = myers(b.subarray(p, b.length - q), a.subarray(p, a.length - q));
  if (!inner)
    return { hunks: [{ bs: p, be: b.length - q, as: p, ae: a.length - q }], exact: false };
  const hunks = inner.map((h) => ({ bs: h.bs + p, be: h.be + p, as: h.as + p, ae: h.ae + p }));
  return { hunks, exact: true };
}

function myers(b: Uint8Array, a: Uint8Array): Hunk[] | null {
  const [n, m] = [b.length, a.length];
  const max = Math.min(n + m, MAX_EDITS);
  const mid = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let work = 0;
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && at(v, mid + k - 1) < at(v, mid + k + 1));
      const from = down ? at(v, mid + k + 1) : at(v, mid + k - 1) + 1;
      let [x, y] = [from, from - k];
      while (x < n && y < m && b[x] === a[y]) [x, y] = [x + 1, y + 1];
      work += x - from + 1;
      v[mid + k] = x;
      if (x >= n && y >= m) return backtrack(trace, mid, n, m, d);
      if (work > MAX_WORK) return null;
    }
  }
  return null;
}

/** Walk the trace back from (n, m) and merge neighbouring one-byte edits into hunks. */
function backtrack(trace: Int32Array[], mid: number, n: number, m: number, depth: number): Hunk[] {
  const edits: Array<{ x: number; y: number; removes: boolean }> = [];
  let [x, y] = [n, m];
  for (let d = depth; d > 0; d--) {
    const v = trace[d] as Int32Array; // as it stood before step d
    const k = x - y;
    const down = k === -d || (k !== d && at(v, mid + k - 1) < at(v, mid + k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(v, mid + prevK);
    edits.push({ x: prevX, y: prevX - prevK, removes: !down });
    [x, y] = [prevX, prevX - prevK];
  }
  const hunks: Hunk[] = [];
  for (const edit of edits.reverse()) {
    const last = hunks.at(-1);
    if (last && last.be === edit.x && last.ae === edit.y) {
      if (edit.removes) last.be++;
      else last.ae++;
    } else {
      const [be, ae] = edit.removes ? [edit.x + 1, edit.y] : [edit.x, edit.y + 1];
      hunks.push({ bs: edit.x, be, as: edit.y, ae });
    }
  }
  return hunks;
}

function at(v: Int32Array, index: number): number {
  return v[index] as number;
}

/** The first byte of `h` that no span covers. */
function firstOutside(h: Hunk, spans: readonly Span[]): number {
  const covering = spans.find((s) => s.start <= h.bs && h.bs < s.end);
  return covering ? covering.end : h.bs;
}

/** Where byte `x` of before is in after; a span's start or end takes in a change touching it. */
function toAfter(hunks: readonly Hunk[], x: number, side: "start" | "end"): number {
  let shift = 0;
  for (const h of hunks) {
    if (h.be < x || (h.be === x && h.bs < x)) {
      shift = h.ae - h.be;
      continue;
    }
    if (h.bs > x || (h.bs === x && h.be > x && side === "end")) break;
    return side === "start" ? h.as : h.ae;
  }
  return x + shift;
}

function listed(hunks: readonly Hunk[], b: Uint8Array, a: Uint8Array, names: [string, string]) {
  const lines = hunks.slice(0, LISTED).map((h) => {
    const [from, to] = [preview(b.subarray(h.bs, h.be)), preview(a.subarray(h.as, h.ae))];
    return `  ${names[0]}[${h.bs}..${h.be}) ${from} → ${names[1]}[${h.as}..${h.ae}) ${to}`;
  });
  if (hunks.length > LISTED) lines.push(`  and ${hunks.length - LISTED} more`);
  return lines;
}

/** `name @start  hex with [the byte at]  "text"`, 16 bytes from a little before `at`. */
function window(name: string, bytes: Uint8Array, at: number): string {
  const start = Math.max(0, at - LEAD);
  const end = Math.min(bytes.length, start + WINDOW);
  const hex: string[] = [];
  for (let i = start; i < end; i++) {
    const pair = (bytes[i] as number).toString(16).padStart(2, "0");
    hex.push(i === at ? `[${pair}]` : pair);
  }
  if (at >= bytes.length) hex.push("[end]");
  const text = quote(bytes.subarray(start, end));
  return `  ${name.padEnd(6)} @${start}  ${hex.join(" ").padEnd(WINDOW * 3 + 6)}  ${text}`;
}

/** The bytes as a quoted string: escapes for control and invisible characters, a BOM included. */
function quote(bytes: Uint8Array): string {
  return JSON.stringify(decoder.decode(bytes)).replace(
    /[\u007f-\u009f\u00ad\u200b-\u200f\u2028\u2029\u2060\ufeff]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function preview(bytes: Uint8Array): string {
  return bytes.length > PREVIEW ? `${quote(bytes.subarray(0, PREVIEW))}…` : quote(bytes);
}

/** `line L, column C` of byte `at`: lines end with LF, columns count bytes from 1. */
function lineOf(bytes: Uint8Array, at: number): string {
  let [line, start] = [1, 0];
  for (let i = 0; i < at && i < bytes.length; i++) {
    if (bytes[i] === 0x0a) [line, start] = [line + 1, i + 1];
  }
  return `line ${line}, column ${at - start + 1}`;
}

function commonPrefix(b: Uint8Array, a: Uint8Array): number {
  const n = Math.min(b.length, a.length);
  let i = 0;
  while (i < n && b[i] === a[i]) i++;
  return i;
}

/** Whether `piece` sits in `bytes` at `offset`. */
function equalAt(bytes: Uint8Array, offset: number, piece: Uint8Array): boolean {
  if (offset < 0 || offset + piece.length > bytes.length) return false;
  for (let i = 0; i < piece.length; i++) if (bytes[offset + i] !== piece[i]) return false;
  return true;
}

/** The first offset in [from, end - piece.length] where `piece` sits in `bytes`, or -1. */
function indexOf(bytes: Uint8Array, piece: Uint8Array, from: number, end: number): number {
  for (let i = from; i + piece.length <= end; i++) if (equalAt(bytes, i, piece)) return i;
  return -1;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0] as Uint8Array;
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
