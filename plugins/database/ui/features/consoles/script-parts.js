// A script read from its file a range at a time (run-file.js), cut as the console cuts one
// (sql/split.js) wherever a range ends, then grouped into parts that each run as one console run.
// A part ends only between statements outside a transaction, at its size or its count of
// statements; a transaction larger than a part may be is refused at its first line. Each part
// starts with the settings the parts before it made (SET, pg_dump's set_config, a SQLite PRAGMA
// that assigns), since a run is a session of its own until consoles keep one (PG-02); SET LOCAL
// and what a RESET takes back are not carried. pg_dump's `\restrict` and `\unrestrict` lines (17.6
// and later, a guard against meta-commands, which no run here sends) are read as blanks of their
// length, so a plain dump runs (features/backup/). Pure.

import { formatCount } from "../../format.js";
import { tokenize } from "../../sql/lexer.js";
import { split } from "../../sql/split.js";

/**
 * @typedef {import("../../sql/split.js").Statement} Statement
 * @typedef {import("../../sql/lexer.js").Dialect} Dialect
 * @typedef {{ statements: Statement[], replayed: number }} Part
 *   `statements` begin with the `replayed` settings of the parts before.
 */

/** The most a statement still being read may hold, in characters. */
const PENDING_MAX = 16 * 1024 * 1024;
/** pg_dump's guard lines, whole: what follows them (a line break, or the script's end) is read. */
const GUARD = /^\\(?:un)?restrict [A-Za-z0-9]+(?=\r?\n)/gmu;
const GUARD_LAST = /^\\(?:un)?restrict [A-Za-z0-9]+(?=\r?\n|$(?![\s\S]))/gmu;

/** A PostgreSQL script with pg_dump's guard lines blanked, every offset kept. */
export function unguarded(/** @type {string} */ text, final = false) {
  if (!text.includes("restrict ")) return text;
  return text.replace(final ? GUARD_LAST : GUARD, (line) => " ".repeat(line.length));
}
const encoder = new TextEncoder();

/**
 * Cuts a script given in pieces into statements as split() would cut the whole, with their
 * offsets, lines and columns in the whole script.
 * @param {Dialect} dialect
 */
export function createScriptReader(dialect) {
  let pending = "";
  /** Where `pending` starts in the script: offset, line and column. */
  let base = 0;
  let line = 1;
  let column = 1;
  /** The MySQL delimiter in effect where `pending` starts. */
  let delimiter = ";";

  const cut = (final = false) => {
    const prefix = dialect === "mysql" && delimiter !== ";" ? `DELIMITER ${delimiter}\n` : "";
    const text = prefix + (dialect === "postgresql" ? unguarded(pending, final) : pending);
    const shift = base - prefix.length;
    const lines = prefix ? 1 : 0;
    /** @returns {Statement} */
    const lift = (/** @type {Statement} */ s) => {
      const at = s.line - lines;
      return {
        ...s,
        start: s.start + shift,
        end: s.end + shift,
        line: line + at - 1,
        column: at === 1 ? column + s.column - 1 : s.column,
        tokens: s.tokens.map((t) => ({ ...t, start: t.start + shift, end: t.end + shift })),
      };
    };
    return { text, prefix, statements: split(text, dialect), lift };
  };
  /** Drop what comes before `offset` in `pending`, keeping where the rest starts. */
  const advance = (/** @type {number} */ offset) => {
    const gone = pending.slice(0, offset);
    const breaks = gone.split("\n").length - 1;
    if (breaks > 0) {
      line += breaks;
      column = offset - gone.lastIndexOf("\n");
    } else column += offset;
    base += offset;
    pending = pending.slice(offset);
  };

  return {
    /** The statements a piece completes. */
    push(/** @type {string} */ piece) {
      pending += piece;
      const { text, prefix, statements, lift } = cut();
      const last = statements.at(-1);
      if (!last || statements.length < 2) {
        if (pending.length > PENDING_MAX)
          throw new Error(`line ${formatCount(line)} holds a statement larger than 16 MiB.`);
        return [];
      }
      if (dialect === "mysql") {
        // The DELIMITER lines read before the statement kept say what ends the ones after it.
        const marks = tokenize(text.slice(0, last.start), dialect).filter(
          (t) => t.type === "delimiter",
        );
        delimiter = marks.at(-1)?.text ?? delimiter;
      }
      const done = statements.slice(0, -1).map(lift);
      advance(last.start - prefix.length);
      return done;
    },
    /** The statements left when the script ends. */
    end() {
      const { statements, lift } = cut(true);
      const done = statements.map(lift);
      advance(pending.length);
      return done;
    },
  };
}

const SET_CONFIG =
  /^select\s+(?:pg_catalog\.)?set_config\s*\(\s*'((?:[^']|'')+)'\s*,\s*'(?:[^']|'')*'\s*,\s*false\s*\)$/iu;
const name = (/** @type {string} */ text) => text.toLowerCase().replace(/\s+/gu, " ");

/**
 * What a statement does to the settings a later part carries: sets one, takes one (or all) back.
 * @param {string} text
 * @param {Dialect} dialect
 * @returns {{ set: string } | { reset: string } | null}
 */
export function settingOf(text, dialect) {
  const head = text.length > 4096 ? text.slice(0, 4096) : text;
  if (dialect === "sqlite") {
    const pragma = /^pragma\s+([\w.]+)\s*=/iu.exec(head);
    return pragma ? { set: name(pragma[1] ?? "") } : null;
  }
  if (dialect === "postgresql") {
    const config = SET_CONFIG.exec(head);
    if (config) return { set: name(config[1] ?? "") };
    if (/^(?:reset\s+all|discard\s+all)$/iu.test(head)) return { reset: "*" };
    const reset = /^reset\s+(.+)$/iu.exec(head);
    if (reset) return { reset: name(reset[1] ?? "") };
    const set =
      /^set\s+(?:session\s+)?(?!local\s|transaction\s|constraints\s)(time\s+zone|"[^"]+"|[\w.]+)/iu.exec(
        head,
      );
    return set ? { set: name(set[1] ?? "") } : null;
  }
  if (
    /^set\s+(?:global|persist|persist_only|transaction)\b|^set\s+@@(?:global|persist)/iu.test(head)
  )
    return null;
  const set =
    /^set\s+(?:session\s+|local\s+|@@session\.|@@local\.|@@)?(character\s+set|@?[\w.$]+)/iu.exec(
      head,
    );
  if (!set) return null;
  // `SET a = 1, b = 2` sets two: kept whole, under its own text.
  return { set: /,/u.test(head) ? head : name(set[1] ?? "") };
}

/** Whether a statement opens a transaction, ends one, or neither. */
export function transactionOf(/** @type {string} */ text) {
  const head = text.slice(0, 80).toLowerCase();
  if (/^(?:begin|start\s+transaction)\b/u.test(head))
    return /^begin\s+not\s+atomic\b/u.test(head) ? null : "begin";
  if (/^(?:commit|end|rollback|abort)\b/u.test(head) && !/^rollback\b[^;]*\bto\b/u.test(head))
    return "end";
  return null;
}

/**
 * Groups statements into parts.
 * @param {{ dialect: Dialect, bytes: number, statements: number, max: number, most?: number }} limits
 *   A part ends at `bytes` of statements or `statements` of them, outside a transaction; one
 *   transaction may hold up to `max` bytes and `most` statements.
 */
export function createParts({ dialect, bytes, statements: count, max, most = Infinity }) {
  /** The settings later parts carry, by name, in the order they were made. */
  /** @type {Map<string, Statement>} */
  const settings = new Map();
  /** @type {Statement[]} */
  let current = [];
  /** @type {Statement[]} */
  let replay = [];
  let size = 0;
  /** The statement that opened the transaction going on, if any. */
  /** @type {Statement | null} */
  let open = null;

  /** @returns {Part[]} */
  const close = () => {
    if (current.length === 0) return [];
    const part = { statements: [...replay, ...current], replayed: replay.length };
    current = [];
    size = 0;
    return [part];
  };
  const carry = (/** @type {Statement} */ statement) => {
    const change = settingOf(statement.text, dialect);
    if (!change) return;
    if ("set" in change) {
      settings.delete(change.set);
      settings.set(change.set, statement);
    } else if (change.reset === "*") settings.clear();
    else settings.delete(change.reset);
  };

  return {
    /** Add a statement; the part it completes, if any. */
    add(/** @type {Statement} */ statement) {
      if (current.length === 0) replay = [...settings.values()];
      current.push(statement);
      size += encoder.encode(statement.text).length;
      const step = transactionOf(statement.text);
      if (step === "begin" && !open) open = statement;
      else if (step === "end") open = null;
      carry(statement);
      if (open) {
        if (size > max || current.length > most)
          throw new Error(
            `line ${formatCount(open.line)} holds a transaction larger than one part of a file run may be`,
          );
        return [];
      }
      return size >= bytes || current.length >= count ? close() : [];
    },
    /** The part left when the script ends. */
    end: close,
  };
}
