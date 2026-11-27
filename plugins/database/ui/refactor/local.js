// Rename a name the statement defines itself (PG-33): a CTE, an alias of a FROM item, a select list's
// output name, a SQL routine's parameter. The caret may be on a use or on the definition. Every use
// is a place the parse worker's resolver bound (so nothing in a string or a comment), and the
// definition is found as go to definition finds it (navigate/target.js). A FROM item without an
// alias gets one; an output name without AS gets one. Pure.

import { aimOf, definitionOf, nameAt } from "../navigate/target.js";
import { t as messageText } from "../strings/index.js";
import {
  aliasAfter,
  applyEdits,
  identOf,
  pairsOf,
  significant,
  tokenStarting,
  withListAt,
  written,
} from "./syntax.js";

/**
 * @typedef {import("../sql/parse/scope.js").Name} Name
 * @typedef {import("../sql/parse/scope.js").Source} Source
 * @typedef {import("../navigate/target.js").Aim} Aim
 * @typedef {import("./syntax.js").Edit} Edit
 * @typedef {{ kind: "cte", name: string, at: number }
 *   | { kind: "alias", name: string, of: Source }
 *   | { kind: "output", name: string, at: number }
 *   | { kind: "parameter", name: string }} Local
 *   `at` is where a CTE's name or an output's expression starts.
 * @typedef {{ local: Local } | { object: Aim } | { reason: string }} Target
 */

const same = (/** @type {unknown} */ a, /** @type {unknown} */ b) =>
  JSON.stringify(a) === JSON.stringify(b);

/** The FROM items' aliases (or names) of the statement, each with the relation name it follows. */
function aliases(/** @type {string} */ text, /** @type {Name[]} */ names) {
  const tokens = significant(text);
  return names.flatMap((n) => {
    if (n.kind !== "relation" || !n.target) return [];
    const i = tokenStarting(tokens, n.start.offset);
    const a = i < 0 ? -1 : aliasAfter(tokens, i);
    const token = tokens[a];
    return token ? [{ relation: n, token, name: /** @type {string} */ (identOf(token)) }] : [];
  });
}

/** The CTEs of every WITH list in the statement. */
function ctes(/** @type {string} */ text) {
  const tokens = significant(text);
  const { close } = pairsOf(tokens);
  return tokens.flatMap((t, i) =>
    identOf(t) === "with" ? (withListAt(tokens, close, i)?.entries ?? []) : [],
  );
}

/** A name at the caret's use as what it stands for. @returns {Target | null} */
function fromUse(/** @type {Name} */ n) {
  const t = n.target;
  if (t?.kind === "column" && t.of.kind === "function")
    return { local: { kind: "parameter", name: t.name } };
  if (t?.kind === "column" && n.kind === "column" && t.of.kind !== "relation")
    return { reason: messageText("refactor.local.isAColumnOfACte", { name: String(t.name) }) };
  const aim = aimOf(n);
  if (!aim) return null;
  if (aim.kind === "cte" || aim.kind === "alias") return { local: aim };
  if (aim.kind === "output")
    return aim.at === null ? null : { local: { kind: "output", name: aim.name, at: aim.at } };
  return { object: aim };
}

/**
 * What the caret is on: a name the statement defines, an object of the schema, or why neither.
 * @param {string} text the statement
 * @param {Name[]} names its resolution
 * @param {number} caret
 * @returns {Target | null}
 */
export function targetAt(text, names, caret) {
  const n = nameAt(names, caret);
  if (n) return fromUse(n);
  const tokens = significant(text);
  const tok = tokens.find((t) => t.start <= caret && caret <= t.end && identOf(t) !== undefined);
  if (!tok) return null;
  const word = /** @type {string} */ (identOf(tok));
  const cte = ctes(text).find((e) => tokens[e.nameAt]?.start === tok.start);
  if (cte) return { local: { kind: "cte", name: cte.name, at: tok.start } };
  for (const a of aliases(text, names))
    if (a.token.start === tok.start)
      return {
        local: { kind: "alias", name: a.name, of: /** @type {Source} */ (a.relation.target) },
      };
  for (const u of names) {
    const t = u.target;
    if (t?.kind === "output" && t.name === word && t.position) {
      const def = definitionOf(text, names, {
        aim: { kind: "output", name: t.name, at: t.position.offset },
        from: u.start.offset,
        to: u.end.offset,
      });
      if (def && def.from === tok.start)
        return { local: { kind: "output", name: word, at: t.position.offset } };
    }
    if (
      t?.kind === "column" &&
      t.of.kind === "function" &&
      t.name === word &&
      tok.start < u.start.offset
    )
      return { local: { kind: "parameter", name: word } };
  }
  return null;
}

/** The names of the same kind the statement defines, which a new name must not take. */
function taken(
  /** @type {string} */ text,
  /** @type {Name[]} */ names,
  /** @type {Local} */ local,
) {
  if (local.kind === "cte") return new Set(ctes(text).map((e) => e.name));
  if (local.kind === "alias") return new Set(aliases(text, names).map((a) => a.name));
  if (local.kind === "output")
    return new Set(names.flatMap((n) => (n.target?.kind === "output" ? [n.target.name] : [])));
  return new Set(parameters(text).map((p) => p.name));
}

/** A CREATE FUNCTION's parameter names in its list, as tokens. */
function parameters(/** @type {string} */ text) {
  const tokens = significant(text);
  const { close } = pairsOf(tokens);
  const at = tokens.findIndex((t) => {
    const w = identOf(t);
    return w === "function" || w === "procedure";
  });
  if (at < 0) return [];
  const open = tokens.findIndex((t, i) => i > at && t.text === "(");
  const shut = close.get(open) ?? -1;
  const { around } = pairsOf(tokens);
  /** @type {{ name: string, token: import("../sql/lexer.js").Token }[]} */
  const out = [];
  for (let i = open + 1; i < shut; i++) {
    if (around[i] !== open || (tokens[i - 1]?.text !== "(" && tokens[i - 1]?.text !== ","))
      continue;
    let j = i;
    if (["in", "out", "inout", "variadic"].includes(identOf(tokens[j]) ?? "")) j++;
    const name = identOf(tokens[j]);
    // A parameter without a name is its type alone: a name is followed by its type.
    if (name !== undefined && identOf(tokens[j + 1]) !== undefined)
      out.push({ name, token: /** @type {any} */ (tokens[j]) });
  }
  return out;
}

/**
 * Every edit that renames a local name.
 * @param {string} text
 * @param {Name[]} names
 * @param {Local} local
 * @param {string} to the new name, as the server holds it
 * @returns {Edit[]}
 */
function editsOf(text, names, local, to) {
  const name = written(to);
  const at = (/** @type {Name} */ n) => ({ from: n.start.offset, to: n.end.offset, insert: name });
  const tokens = significant(text);
  if (local.kind === "cte") {
    const def = tokens[tokenStarting(tokens, local.at)];
    const uses = names.filter((n) => {
      const t = n.target;
      if (n.kind === "relation" && t?.kind === "cte") return t.position.offset === local.at;
      return (
        n.kind === "qualifier" &&
        t?.kind === "range" &&
        t.name === local.name &&
        t.of.kind === "cte" &&
        t.of.position.offset === local.at
      );
    });
    return [...(def ? [{ from: def.start, to: def.end, insert: name }] : []), ...uses.map(at)];
  }
  if (local.kind === "alias") {
    const uses = names.filter(
      (n) =>
        n.kind === "qualifier" &&
        n.target?.kind === "range" &&
        n.target.name === local.name &&
        same(n.target.of, local.of),
    );
    const given = aliases(text, names).find(
      (a) => a.name === local.name && same(a.relation.target, local.of),
    );
    /** @type {Edit[]} */
    const edits = uses.map(at);
    if (given) edits.push({ from: given.token.start, to: given.token.end, insert: name });
    else {
      // No alias: the FROM item is reached by its own name, which keeps it and gains one.
      const own = names.find(
        (n) => n.kind === "relation" && n.name === local.name && same(n.target, local.of),
      );
      if (own) edits.push({ from: own.end.offset, to: own.end.offset, insert: ` AS ${name}` });
    }
    return edits;
  }
  if (local.kind === "output") {
    const uses = names.filter(
      (n) => n.target?.kind === "output" && n.target.position?.offset === local.at,
    );
    const first = uses[0];
    const def = first
      ? definitionOf(text, names, { aim: local, from: first.start.offset, to: first.end.offset })
      : null;
    /** @type {Edit[]} */
    const edits = uses.map(at);
    if (!def) return edits;
    const i = tokenStarting(tokens, def.from);
    const bare =
      identOf(tokens[i - 1]) !== "as" &&
      names.some((n) => n.kind === "column" && n.start.offset === def.from);
    edits.push(
      bare ? { from: def.to, to: def.to, insert: ` AS ${name}` } : { ...def, insert: name },
    );
    return edits;
  }
  const uses = names.filter(
    (n) =>
      n.target?.kind === "column" &&
      n.target.of.kind === "function" &&
      n.target.name === local.name,
  );
  const def = parameters(text).find((p) => p.name === local.name);
  return [
    ...(def ? [{ from: def.token.start, to: def.token.end, insert: name }] : []),
    ...uses.map(at),
  ];
}

/**
 * The statement with a local name renamed, or why not.
 * @param {string} text
 * @param {Name[]} names
 * @param {Local} local
 * @param {string} to
 * @returns {{ text: string, places: number } | string}
 */
export function renameLocal(text, names, local, to) {
  if (!to) return messageText("refactor.local.giveTheNewName");
  if (to === local.name)
    return messageText("refactor.local.isItsNameAlready", { name: String(local.name) });
  if (taken(text, names, local).has(to))
    return messageText("refactor.local.isAlreadyOfThisStatement", {
      to: String(to),
      value: String(
        local.kind === "alias" ? messageText("refactor.local.an") : messageText("refactor.local.a"),
      ),
      value2: String(
        local.kind === "cte"
          ? messageText("refactor.local.cte")
          : local.kind === "output"
            ? messageText("refactor.local.outputName")
            : local.kind,
      ),
    });
  const edits = editsOf(text, names, local, to);
  return { text: applyEdits(text, edits), places: edits.length };
}
