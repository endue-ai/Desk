// The problems of a PostgreSQL script, in the parse worker (ADR 0294): the script cut by the
// plugin's splitter (psql's rules), each statement parsed alone by the server's grammar, a syntax
// error with the parser's message at its token, then the statement's names bound against the schema
// model under the search path and what the statements before it made (script.js), and the names
// that bind to nothing (names.js) and INSERT's counts (insert.js) as problems. A statement is parsed
// again only when its text, the model, the search path or what came before it changed: each console
// keeps the last check's statements. A statement the server answered (a run) takes the server's
// word instead. Statements with psql's meta-commands or its `:name` and `?` parameters are skipped.
// The warnings (warnings.js, ADR 0328) are found with the same parse and kept in the same entry; a
// setting's identifiers and the ignore comments (ignore.js) drop them, and a run keeps them.
import { createPositions } from "../sql/parse/positions.js";
import { resolve } from "../sql/parse/resolve.js";
import { split } from "../sql/split.js";
import { ignoredLines } from "./ignore.js";
import { insertProblems } from "./insert.js";
import { nameProblems } from "./names.js";
import { apply, createState, DEFAULT_PATH, effectsOf, searchPathOf } from "./script.js";
import { endOf } from "./text.js";
import { warningsOf } from "./warnings.js";

/**
 * @typedef {import("./names.js").Problem} Problem
 * @typedef {import("./script.js").Effect} Effect
 * @typedef {import("../sql/parse/model.js").ModelIndex} ModelIndex
 * @typedef {{ ok: true } | { message: string, at?: number }} Answer
 *   What the server said of a statement it was sent: it ran, or its message and where it points
 *   (an offset in the statement's text).
 * @typedef {{
 *   doc: string, sql: string, syntax?: boolean, names?: boolean, searchPath?: string[],
 *   user?: string, answers?: Array<[string, Answer]>, warnings?: boolean, off?: string[],
 * }} CheckRequest
 *   `warnings` true finds the warnings too; `off` names the ones never told.
 * @typedef {{ problems: Problem[], statements: number, parsed: number }} CheckResult
 *   `problems` in the script's offsets, at most MAX_PROBLEMS; `parsed` how many statements were
 *   parsed for this check.
 * @typedef {{ problems: Problem[], effects: Effect[] }} Entry
 *   A statement's problems (offsets in its text) and what it does to the ones after it.
 */

export const MAX_PROBLEMS = 1000;
/** Consoles whose statements the worker keeps; the one checked longest ago goes first. */
const KEPT_DOCS = 16;
/** psql meta-commands after which the script reads another database or another file. */
const ELSEWHERE = new Set(["c", "connect", "i", "include", "ir", "include_relative"]);

/** How a statement is skipped: not at all, as psql's (its parameters), or as one that leaves. */
function skipOf(/** @type {import("../sql/split.js").Statement} */ piece) {
  const tokens = piece.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const t = /** @type {import("../sql/lexer.js").Token} */ (tokens[i]);
    if (t.type === "op" && t.text === "\\") {
      const word = tokens[i + 1]?.text ?? "";
      return ELSEWHERE.has(word) ? "elsewhere" : "psql";
    }
    if (t.type === "param" && t.text === "?") return "psql";
    const before = tokens[i - 1];
    const cast = before?.type === "op" && before.text === ":";
    if (t.type === "param" && t.text.startsWith(":") && !cast) return "psql";
    // :'name' and :"name", psql's variables as a literal and as an identifier.
    const next = tokens[i + 1];
    const quoted = next?.start === t.end && (next.type === "string" || next.type === "name");
    if (t.type === "op" && t.text === ":" && quoted && !cast) return "psql";
  }
  return "";
}

/** What the server refused, where it points (its first token when it points nowhere). */
function serverProblem(
  /** @type {import("../sql/split.js").Statement} */ piece,
  /** @type {{ message: string, at?: number }} */ answer,
) {
  const at = Math.max(0, Math.min(answer.at ?? 0, piece.text.length));
  const to = endOf(piece.tokens, piece.start + at) - piece.start;
  return /** @type {Problem} */ ({ from: at, to, kind: "server", message: answer.message });
}

/** Drops the warnings on a line an ignore comment covers (ignore.js). */
function dropIgnored(
  /** @type {string} */ sql,
  /** @type {import("../sql/split.js").Statement[]} */ pieces,
  /** @type {Problem[]} */ problems,
) {
  const { ignored, lineOf } = ignoredLines(sql, pieces);
  if (ignored.size === 0) return;
  for (let i = problems.length - 1; i >= 0; i--) {
    const p = /** @type {Problem} */ (problems[i]);
    if (p.kind !== "warning") continue;
    const ids = ignored.get(lineOf(p.from));
    if (ids === null || ids?.has(p.rule ?? "")) problems.splice(i, 1);
  }
}

/** @param {import("../sql/parse/wasm.js").RawParser} raw */
export function createChecker(raw) {
  /** @type {Map<string, Map<string, Entry>>} */
  const docs = new Map();
  const ids = new WeakMap();
  let nextId = 0;
  const idOf = (/** @type {object | undefined} */ index) => {
    if (!index) return 0;
    if (!ids.has(index)) ids.set(index, ++nextId);
    return ids.get(index);
  };

  /** One statement, parsed and bound under the state the ones before it left. */
  const analyse = (
    /** @type {import("../sql/split.js").Statement} */ piece,
    /** @type {import("./script.js").State} */ state,
    /** @type {{ syntax: boolean, names: boolean, warnings: boolean }} */ kinds,
  ) => {
    const text = ` ${piece.text}`;
    const read = raw.parse(text);
    /** @type {Entry} */
    const entry = { problems: [], effects: [] };
    const tokens = piece.tokens;
    const endAt = (/** @type {number} */ at, expression = false) =>
      endOf(tokens, piece.start + at, expression) - piece.start;
    if ("error" in read) {
      if (!kinds.syntax) return entry;
      const positions = createPositions(text);
      const { message, cursor } = read.error;
      const at = cursor > 1 ? positions.ofCharacter(cursor - 1).offset - 1 : 0;
      const past = at >= piece.text.length;
      const to = past ? at : endAt(at);
      entry.problems.push({ from: Math.min(at, piece.text.length), to, kind: "syntax", message });
      return entry;
    }
    const positions = createPositions(text);
    for (const stmt of read.tree.stmts ?? []) {
      const tree = stmt.stmt ?? {};
      /** @type {import("../sql/parse/scope.js").Name[]} */
      let names = [];
      const bound = state.index && !state.opaque;
      if (bound && (kinds.names || kinds.warnings)) {
        const parsed = { version: 0, whole: true, statements: [{ kind: null, tree }] };
        ({ names } = resolve(text, /** @type {never} */ (parsed), state.index, {
          searchPath: searchPathOf(state),
          user: state.user,
          positions,
        }));
      }
      if (bound && kinds.names) {
        const shift = (/** @type {Problem} */ p) => ({ ...p, from: p.from - 1, to: p.to - 1 });
        entry.problems.push(...nameProblems(names, tree, state, text).map(shift));
        const offsetOf = (/** @type {number} */ byte) => positions.at(byte).offset - 1;
        entry.problems.push(...insertProblems(tree, state, offsetOf, endAt));
      }
      if (kinds.warnings) {
        const input = { tree, text, positions, names, state, tokens, start: piece.start, raw };
        entry.problems.push(...warningsOf(input));
      }
      const effects = effectsOf(tree);
      entry.effects.push(...effects);
      for (const effect of effects) apply(state, effect);
    }
    return entry;
  };

  return {
    /**
     * @param {CheckRequest} request
     * @param {ModelIndex | undefined} index the schema model, or none: syntax alone
     * @returns {CheckResult}
     */
    check(request, index) {
      const kinds = {
        syntax: request.syntax !== false,
        names: request.names !== false,
        warnings: request.warnings === true,
      };
      const off = new Set(request.off ?? []);
      const kept = docs.get(request.doc) ?? new Map();
      docs.delete(request.doc);
      /** @type {Map<string, Entry>} */
      const next = new Map();
      const state = createState(index, request.searchPath ?? [...DEFAULT_PATH], request.user ?? "");
      const answers = new Map(request.answers ?? []);
      /** @type {Problem[]} */
      const problems = [];
      const pieces = split(request.sql, "postgresql");
      let parsed = 0;
      for (const piece of pieces) {
        if (state.stopped) break;
        const skip = skipOf(piece);
        if (skip === "elsewhere") state.opaque = true;
        if (skip) continue;
        const key = [
          piece.text,
          idOf(index),
          state.path.join(","),
          state.user,
          state.version,
          state.opaque,
          kinds.syntax,
          kinds.names,
          kinds.warnings,
        ].join("\u0000");
        let entry = next.get(key) ?? kept.get(key);
        if (entry) for (const effect of entry.effects) apply(state, effect);
        else {
          entry = analyse(piece, state, kinds);
          parsed++;
        }
        next.set(key, entry);
        // The server's answer replaces the check's errors; the warnings stay.
        const answer = answers.get(piece.text);
        const shown = (/** @type {Problem} */ p) => p.kind !== "warning" || !off.has(p.rule ?? "");
        const told = answer
          ? [
              ...("ok" in answer ? [] : [serverProblem(piece, answer)]),
              ...entry.problems.filter((p) => p.kind === "warning"),
            ]
          : entry.problems;
        for (const p of told.filter(shown))
          problems.push({ ...p, from: p.from + piece.start, to: p.to + piece.start });
      }
      if (kinds.warnings) dropIgnored(request.sql, pieces, problems);
      docs.set(request.doc, next);
      while (docs.size > KEPT_DOCS) docs.delete(/** @type {string} */ (docs.keys().next().value));
      problems.sort((a, b) => a.from - b.from || a.to - b.to);
      return { problems: problems.slice(0, MAX_PROBLEMS), statements: pieces.length, parsed };
    },
    /** Forget a console's statements. */
    forget: (/** @type {string} */ doc) => void docs.delete(doc),
  };
}
