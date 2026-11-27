// The problems inside a PL/pgSQL body (PG-35, ADR 0343), in the parse worker beside the statement's
// own: the routine's statement parsed by PostgreSQL's PL/pgSQL grammar (the vendored parser's
// parse_plpgsql, which also reads the SQL inside with the server's grammar). Its message comes
// without a position, so the statement it is in is found by parsing the body cut after each `;`
// with its open blocks closed (a binary search: the first cut that fails the same way holds it),
// then the token the message names, or the `;` an unfinished expression ends at. A body that parses
// is checked further (plpgsql-checks.js): names never declared, variables never used, code that
// cannot run. Offsets in the statement's text. Pure but for the parser.

import { bodiesIn } from "../sql/plpgsql/bodies.js";
import { outlineOf } from "../sql/plpgsql/outline.js";
import { t as messageText } from "../strings/index.js";
import { undeclared, unreachable, unused } from "./plpgsql-checks.js";

/**
 * @typedef {import("./names.js").Problem} Problem
 * @typedef {import("../sql/plpgsql/bodies.js").Body} Body
 * @typedef {import("../sql/lexer.js").Token} Token
 * @typedef {{ syntax: boolean, names: boolean, warnings: boolean }} Kinds
 */

const CLOSERS = { block: "END;", if: "END IF;", loop: "END LOOP;", case: "END CASE;" };
const QUOTED = /"((?:[^"]|"")*)"/u;

/** The statement with its body cut at `cut` (an offset in it) and its open blocks closed. */
function cutAt(/** @type {string} */ text, /** @type {Body} */ body, /** @type {number} */ cut) {
  const head = text.slice(body.from, cut);
  const open = outlineOf(head, body.from).constructs.filter((c) => c.end === null);
  const closing = open
    .reverse()
    .map((c) =>
      c.kind === "block" && c.begin === null ? `BEGIN ${CLOSERS.block}` : CLOSERS[c.kind],
    )
    .join(" ");
  return `${text.slice(0, cut)}\n${closing}\n${text.slice(body.to)}`;
}

/** Where the grammar's `message` points in the body: a token, found by cutting the body. */
function locate(
  /** @type {import("../sql/parse/wasm.js").RawParser} */ raw,
  /** @type {string} */ text,
  /** @type {Body} */ body,
  /** @type {string} */ message,
) {
  const tokens = outlineOf(text.slice(body.from, body.to), body.from).tokens.filter(
    (t) => t.type !== "space" && t.type !== "comment",
  );
  const cuts = tokens.filter((t) => t.type === "end");
  const same = (/** @type {number} */ k) => {
    const read = raw.plpgsql(cutAt(text, body, /** @type {Token} */ (cuts[k]).end));
    return "error" in read && read.error === message;
  };
  // The first cut whose closed prefix fails with the full body's message.
  let lo = 0;
  let hi = cuts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (same(mid)) hi = mid;
    else lo = mid + 1;
  }
  const after = lo > 0 ? (cuts[lo - 1]?.end ?? body.from) : body.from;
  const stop = cuts[lo] ?? tokens.at(-1);
  const inside = tokens.filter((t) => t.start >= after && (!stop || t.end <= stop.end));
  const named = QUOTED.exec(message)?.[1]?.replaceAll('""', '"').toLowerCase();
  // The grammar stops at the farthest token it read: the last of that name in the statement.
  const hit =
    named && !/end of input/u.test(message)
      ? inside.findLast(
          (t) => t.text.toLowerCase() === named || t.text.slice(1, -1).toLowerCase() === named,
        )
      : undefined;
  const at = hit ?? stop ?? inside.at(-1);
  return at ? { from: at.start, to: at.end } : { from: body.from, to: body.from };
}

/** The line of the body an offset is on, from 1 (the line its opening quote is on). */
export const lineIn = (
  /** @type {string} */ text,
  /** @type {Body} */ body,
  /** @type {number} */ at,
) => text.slice(body.from, at).split("\n").length;

/**
 * The problems of the PL/pgSQL bodies of one statement that parsed as SQL.
 * @param {import("../sql/parse/wasm.js").RawParser} raw
 * @param {string} text the statement
 * @param {Kinds} kinds
 * @returns {Problem[]}
 */
export function plpgsqlProblems(raw, text, kinds) {
  if (!raw.plpgsql) return [];
  const bodies = bodiesIn(text).filter((b) => b.closed);
  if (bodies.length === 0) return [];
  const read = raw.plpgsql(text);
  /** @type {Problem[]} */
  const problems = [];
  if ("error" in read) {
    const body = bodies[0];
    if (!kinds.syntax || !body) return [];
    const { from, to } = locate(raw, text, body, read.error);
    const line = lineIn(text, body, from);
    const message = messageText("diagnose.plpgsql.plPgsqlLineOfTheBody", {
      error: String(read.error),
      line: String(line),
    });
    return [{ from, to, kind: "syntax", message }];
  }
  bodies.forEach((body, i) => {
    const tree = read.funcs[i]?.PLpgSQL_function;
    if (!tree) return;
    const outline = outlineOf(text.slice(body.from, body.to), body.from);
    const input = { text, body, outline, tree, raw };
    if (kinds.names) problems.push(...undeclared(input));
    if (kinds.warnings) problems.push(...unused(input), ...unreachable(input));
  });
  return problems;
}
