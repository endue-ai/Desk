// The editor's tokens of a script of any size, from the lexer statements are cut with
// (`ui/sql/lexer.js`), never over the whole text at once. Checkpoints about every 16 KiB hold the
// lexer's state at the start of a line (the MySQL delimiter, whether a statement may start, where
// the statement there began); a range is lexed from the nearest checkpoint before it, so the lines on
// screen cost a few KiB of lexing. After an edit the checkpoints before it stay, the later ones wait
// to be checked again (`work`, in slices), and checking stops at the first one whose state is
// unchanged. Pure: a source is anything with `length` and `sliceString(from, to)`.

import { tokenize } from "../sql/lexer.js";

/**
 * @typedef {import("../sql/lexer.js").Dialect} Dialect
 * @typedef {import("../sql/lexer.js").Token} Token
 * @typedef {{ length: number, sliceString(from: number, to?: number): string }} Source
 * @typedef {{ delimiter: string, fresh: boolean, stmt: number, stmtDelimiter: string }} State
 *   `stmt`: where the statement in progress starts (after the last terminator); `stmtDelimiter` the
 *   delimiter in force there.
 * @typedef {State & { pos: number }} Point
 * @typedef {{ iterChangedRanges(f: (fromA: number, toA: number) => void): void,
 *   mapPos(pos: number, assoc?: number): number }} Changes
 */

/** How far apart checkpoints are. */
export const CHUNK = 16384;
/** The farthest a range is lexed on demand past the checked part; beyond, it waits for `work`. */
export const NEAR = 128 * 1024;
/** The most one call of the lexer reads, unless a single token is longer. */
const SLICE = 64 * 1024;
/** Tokens that end this close to a slice's end may continue past it, so they are lexed again. */
const MARGIN = 128;

/** @returns {State} */
const initial = () => ({ delimiter: ";", fresh: true, stmt: 0, stmtDelimiter: ";" });
const same = (/** @type {State} */ a, /** @type {State} */ b) =>
  a.delimiter === b.delimiter &&
  a.fresh === b.fresh &&
  a.stmt === b.stmt &&
  a.stmtDelimiter === b.stmtDelimiter;
const ends = (/** @type {Token} */ t) => t.type === "end" || t.type === "delimiter";

/**
 * What goes before a slice so the lexer starts it in `state`: a DELIMITER line, and a word when a
 * statement is under way (MySQL reads DELIMITER only where a statement may start).
 * @param {Dialect} dialect @param {State} state
 */
function prefixOf(dialect, state) {
  if (dialect !== "mysql") return "";
  const delimiter = state.delimiter === ";" ? "" : `DELIMITER ${state.delimiter}\n`;
  return `${delimiter}${state.fresh ? "" : "x\n"}`;
}

/** Where a line starts inside or right after a token (a space, a DELIMITER line), or -1. */
function lineIn(/** @type {Token} */ token) {
  if (token.type === "space") {
    const nl = token.text.lastIndexOf("\n");
    return nl < 0 ? -1 : token.start + nl + 1;
  }
  return token.type === "delimiter" && token.text.endsWith("\n") ? token.end : -1;
}

/**
 * Lex `source` from `start` (a checkpoint, in `state`) until a token that starts at `to` or after.
 * `onLine(pos, state)` hears every line start between tokens or inside a space; true stops.
 * @param {Dialect} dialect @param {Source} source @param {number} start @param {State} state
 * @param {number} to @param {(pos: number, state: State) => boolean} [onLine]
 * @returns {{ tokens: Token[], end: number, state: State }} `end`: where lexing stopped, a boundary
 */
export function lexFrom(dialect, source, start, state, to, onLine) {
  const n = source.length;
  /** @type {Token[]} */
  const tokens = [];
  const { delimiter, fresh, stmt, stmtDelimiter } = state;
  /** @type {State} */
  let s = { delimiter, fresh, stmt, stmtDelimiter };
  let at = start;
  let span = Math.min(SLICE, Math.max(CHUNK, to - at + MARGIN));
  let past = false;
  while (at < n && !past) {
    const end = Math.min(n, at + span);
    const prefix = prefixOf(dialect, s);
    const text = prefix + source.sliceString(at, end);
    const limit = end >= n ? Number.POSITIVE_INFINITY : end - MARGIN;
    const base = at - prefix.length;
    let moved = false;
    for (const t of tokenize(text, dialect)) {
      if (t.end <= prefix.length) continue;
      const stop = t.end + base;
      if (stop > limit) break;
      const from = Math.max(at, t.start + base);
      const token = { ...t, start: from, end: stop };
      if (from !== t.start + base) token.text = text.slice(from - base, t.end);
      if (t.type !== "space" && t.type !== "comment") s.fresh = ends(t);
      if (t.type === "delimiter") s.delimiter = t.text;
      if (ends(t)) s = { ...s, stmt: stop, stmtDelimiter: s.delimiter };
      tokens.push(token);
      moved = true;
      at = stop;
      const line = lineIn(token);
      if ((line >= 0 && line < n && onLine?.(line, { ...s })) || from >= to) {
        past = true;
        break;
      }
    }
    span = moved ? Math.min(SLICE, Math.max(CHUNK, to - at + MARGIN)) : span * 2;
  }
  return { tokens, end: at, state: s };
}

/** The checkpoints and lexed ranges of one text in one dialect. A new one follows each edit (`map`). */
export class Lexed {
  /**
   * @param {Dialect} dialect @param {Source} source
   * @param {{ points?: Point[], stale?: Point[], marks?: number[], checked?: number, known?: number }} [from]
   *   `points`: checked, in order, the first at 0; `stale`: not checked since an edit, all after the
   *   last checked one; `marks`: where those edits began; `checked`: every line start before it was
   *   seen; `known`: how far the stale points had been checked
   */
  constructor(dialect, source, from = {}) {
    this.dialect = dialect;
    this.source = source;
    /** @type {Point[]} */
    this.points = from.points ?? [{ pos: 0, ...initial() }];
    /** @type {Point[]} */
    this.stale = from.stale ?? [];
    /** @type {number[]} */
    this.marks = from.marks ?? [];
    this.checked = from.checked ?? 0;
    this.known = from.known ?? 0;
    /** @type {{ from: number, to: number, tokens: Token[] } | null} */
    this.window = null;
  }

  /** Whether every checkpoint up to the end is checked. */
  get done() {
    return this.checked >= this.source.length;
  }

  /** The text after `changes`: checkpoints at or before the first change stay checked. */
  map(/** @type {Changes} */ changes, /** @type {Source} */ source) {
    let first = Number.POSITIVE_INFINITY;
    /** @type {[number, number][]} */
    const ranges = [];
    changes.iterChangedRanges((fromA, toA) => {
      first = Math.min(first, fromA);
      ranges.push([fromA, toA]);
    });
    if (first === Number.POSITIVE_INFINITY) return this;
    const points = this.points.filter((p) => p.pos <= first);
    const last = /** @type {Point} */ (points[points.length - 1]).pos;
    const inside = (/** @type {number} */ pos) => ranges.some(([a, b]) => a < pos && pos < b);
    const stale = [...this.points.filter((p) => p.pos > first), ...this.stale]
      .filter((p) => !inside(p.pos))
      .map((p) => ({ ...p, pos: changes.mapPos(p.pos, 1), stmt: changes.mapPos(p.stmt, -1) }));
    const marks = [...this.marks.map((m) => changes.mapPos(m, -1)), first]
      .filter((m) => m > last)
      .sort((a, b) => a - b);
    const known = changes.mapPos(Math.max(this.checked, this.known), 1);
    return new Lexed(this.dialect, source, { points, stale, marks, checked: last, known });
  }

  /** The last checked point at or before `pos`. */
  pointBefore(/** @type {number} */ pos) {
    let lo = 0;
    let hi = this.points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.points[mid]?.pos ?? 0) <= pos) lo = mid;
      else hi = mid - 1;
    }
    return /** @type {Point} */ (this.points[lo]);
  }

  /** A stale point the lexer reached in the same state: it and those up to the next edit hold. */
  converge(/** @type {number} */ pos) {
    const mark = this.marks.find((m) => m > pos) ?? Number.POSITIVE_INFINITY;
    const held = this.stale.filter((p) => p.pos <= mark);
    this.points.push(...held);
    this.stale = this.stale.slice(held.length);
    this.marks = this.marks.filter((m) => m > mark);
    const reached =
      mark === Number.POSITIVE_INFINITY ? this.known : (held[held.length - 1]?.pos ?? pos);
    this.checked = Math.min(this.source.length, Math.max(this.checked, pos, reached));
  }

  /**
   * Lex on from the last checked point, adding and checking points, until `to` or `stop()`.
   * @param {number} to @param {() => boolean} [stop]
   */
  extend(to, stop) {
    if (this.checked >= to) return;
    const from = /** @type {Point} */ (this.points[this.points.length - 1]);
    const target = Math.min(to, this.source.length);
    const { end } = lexFrom(this.dialect, this.source, from.pos, from, target, (pos, state) => {
      while ((this.stale[0]?.pos ?? Number.POSITIVE_INFINITY) < pos) this.stale.shift();
      const old = this.stale[0];
      if (old?.pos === pos && same(old, state)) {
        this.converge(pos);
        return true;
      }
      if (old?.pos === pos) this.stale.shift();
      const last = /** @type {Point} */ (this.points[this.points.length - 1]);
      if (pos - last.pos >= CHUNK) this.points.push({ ...state, pos });
      this.checked = Math.max(this.checked, pos);
      this.marks = this.marks.filter((m) => m > pos);
      return stop?.() ?? false;
    });
    if (end >= this.source.length) this.checked = this.source.length;
  }

  /** Check points onwards until `stop()` says so; true when all are checked. */
  work(/** @type {() => boolean} */ stop) {
    while (!this.done && !stop()) this.extend(this.source.length, stop);
    return this.done;
  }

  /**
   * Tokens that cover `from`..`to`, from a token boundary at or before `from` to one that starts at
   * `to` or after. `exact` is false when they come from a point not checked since an edit, or are
   * missing (empty) because the checked part ends farther than NEAR before `from`: `work` catches up.
   * @param {number} from @param {number} to
   * @returns {{ tokens: Token[], exact: boolean }}
   */
  tokens(from, to) {
    const w = this.window;
    if (w && w.from <= from && w.to >= to) return { tokens: w.tokens, exact: true };
    if (this.checked < from && from - this.checked > NEAR) {
      const guess = [...this.stale].reverse().find((p) => p.pos <= from);
      if (!guess || from - guess.pos > NEAR) return { tokens: [], exact: false };
      return {
        tokens: lexFrom(this.dialect, this.source, guess.pos, guess, to).tokens,
        exact: false,
      };
    }
    this.extend(from);
    const point = this.pointBefore(from);
    const { tokens } = lexFrom(this.dialect, this.source, point.pos, point, to);
    this.window = { from: point.pos, to, tokens };
    return { tokens, exact: true };
  }

  /**
   * The statement `at` is in: from after the terminator before it to after the one that ends it
   * (or `reach` further, or the end), and the delimiter in force where it starts.
   * @param {number} at
   */
  statementAt(at, reach = 256 * 1024) {
    this.extend(at);
    const point = this.pointBefore(at);
    const before = lexFrom(this.dialect, this.source, point.pos, point, at);
    let from = point.stmt;
    let delimiter = point.stmtDelimiter;
    let current = point.delimiter;
    for (const t of before.tokens) {
      if (t.end > at) break;
      if (t.type === "delimiter") current = t.text;
      if (ends(t)) [from, delimiter] = [t.end, current];
    }
    let ended = before.tokens.find((t) => ends(t) && t.start >= at);
    let to = before.end;
    if (!ended && before.end < this.source.length) {
      const stmt = before.state.stmt;
      const target = Math.min(this.source.length, at + reach);
      const after = lexFrom(
        this.dialect,
        this.source,
        before.end,
        before.state,
        target,
        (_p, s) => s.stmt > stmt,
      );
      ended = after.tokens.find(ends);
      to = after.end;
    }
    return { from, to: ended ? ended.end : to, delimiter };
  }
}
