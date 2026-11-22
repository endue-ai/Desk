// The refactorings of a PostgreSQL console (PG-33). The statement at the caret is bound by the parse
// worker's resolver over the schema cache's model, as navigation binds it (navigate/controller.js),
// and a statement refactoring (rename a CTE, an alias, an output name or a parameter; extract a
// subquery into a CTE; inline a CTE; qualify every name) replaces it in one undoable edit. Renaming
// an object of the schema reads what names it (read-sql.js) and opens the script in a console of
// its own, where nothing runs until the person runs it. No DOM.

import { problemModel } from "../diagnose/model.js";
import { aimAt } from "../navigate/target.js";
import { sqlParser } from "../sql/parse/client.js";
import { split, statementAt } from "../sql/split.js";
import { extractCte, inlineCte } from "./cte.js";
import { renameLocal, targetAt } from "./local.js";
import { factsOf, partsOf, renameOf } from "./object.js";
import { qualifyNames } from "./qualify.js";
import { renameReadSql } from "./read-sql.js";
import { labelOf, renameScript } from "./script.js";
import { typed } from "./syntax.js";

/**
 * @typedef {import("../feature-host.js").Deps} Deps
 * @typedef {import("../engines/common.js").Connection} Connection
 * @typedef {import("../navigate/target.js").Aim} Aim
 * @typedef {{ text: string, caret: number, offset: number, length: number }} Window
 */

const SEARCH_PATH = ["$user", "public"];
const NOT_PG = "Rename, extract, inline and qualify read PostgreSQL consoles.";
const NOTHING = "Put the caret on a name the schema holds, a CTE, an alias or a parameter.";

/** The statement at the caret of a console's text. @returns {Window | null} */
export function windowOf(/** @type {string} */ text, /** @type {number} */ caret) {
  const s = statementAt(split(text, "postgresql"), caret, text);
  return s
    ? { text: s.text, caret: caret - s.start, offset: s.start, length: s.text.length }
    : null;
}

/** What a server object is called when the person is asked. */
const aimLabel = (/** @type {Aim} */ a) =>
  a.kind === "column"
    ? `${a.schema}.${a.table}.${a.name}`
    : "schema" in a
      ? `${a.schema}.${a.name}`
      : a.name;

/**
 * @param {Pick<Deps, "consoles" | "manager" | "catalog" | "execute" | "say" | "pick" | "view">} deps
 * @param {() => ReturnType<typeof sqlParser>} [parser]
 */
export function createRefactor(deps, parser = sqlParser) {
  /** The console on screen, its connection and the statement at its caret, resolved. */
  const here = async () => {
    const shown = deps.consoles.current();
    const conn = shown ? deps.manager.get(shown.connection) : undefined;
    if (!shown || !conn || shown.kind !== "console") throw new Error("Open a console first.");
    if (conn.engine !== "postgresql") throw new Error(NOT_PG);
    await deps.catalog.cache.open(conn, true).catch(() => undefined);
    const view = deps.catalog.cache.view(conn);
    const model = problemModel(conn.id, view);
    const sql = parser();
    if (!view || !model || !sql) throw new Error("The schema of this connection is not read yet.");
    const { text, end } = deps.view.editor();
    const w = windowOf(text, end);
    if (!w) throw new Error("The console holds no statement.");
    const { names } = await sql.resolve(w.text, model, {
      searchPath: [...SEARCH_PATH],
      user: conn.user,
    });
    return { conn, view, w, names };
  };

  /** Put a statement's new text in place of the old, in one edit. */
  const apply = (/** @type {Window} */ w, /** @type {string} */ next) => {
    const full = deps.view.editor().text;
    deps.view.replace(w.offset, w.offset + w.length, next);
    deps.consoles.edited(full.slice(0, w.offset) + next + full.slice(w.offset + w.length));
    deps.view.select(
      w.offset + Math.min(w.caret, next.length),
      w.offset + Math.min(w.caret, next.length),
    );
  };

  /** A new name: the one given, else asked. */
  const nameFor = async (
    /** @type {unknown} */ given,
    /** @type {string} */ what,
    /** @type {string} */ now,
  ) => {
    const to =
      typeof given === "string"
        ? given
        : await deps.pick(`Database: rename ${what} to?`, [], true, now);
    if (to === undefined) return undefined;
    const name = typed(to);
    if (!name) throw new Error("Give the new name.");
    return name;
  };

  /** The rename of a server object as a script in a console of its own. */
  const renameObject = async (
    /** @type {Connection} */ conn,
    /** @type {Aim} */ aim,
    /** @type {Record<string, unknown>} */ args,
  ) => {
    if (
      aim.kind !== "relation" &&
      aim.kind !== "column" &&
      aim.kind !== "function" &&
      aim.kind !== "type" &&
      aim.kind !== "schema"
    )
      throw new Error(NOTHING);
    const to = await nameFor(args.to, aimLabel(aim), aim.name);
    if (to === undefined) return undefined;
    const run = await deps.execute(conn, renameReadSql(aim), { catalog: true, maxRows: 600 });
    const failed = run.result.error ?? run.result.statements.find((s) => s.error)?.error;
    if (failed) throw new Error(failed.message);
    const [factRows = [], bodies = [], catalog = []] = run.result.statements.map(
      (s) => s.sets[0]?.rows ?? [],
    );
    const facts = factsOf(factRows);
    if (!facts) throw new Error(`The server holds no ${aimLabel(aim)}.`);
    let overload = 0;
    if (aim.kind === "function" && facts.overloads.length > 1) {
      const given =
        typeof args.args === "string" ? facts.overloads.findIndex(([a]) => a === args.args) : -1;
      overload = given;
      if (given < 0) {
        const id = await deps.pick(
          `Database: which ${aim.name}?`,
          facts.overloads.map(([a], i) => ({ id: String(i), label: `${aim.name}(${a})` })),
        );
        if (id === undefined) return undefined;
        overload = Number(id);
      }
    }
    const r = renameOf(aim, facts, to, overload);
    const parts = partsOf(r, facts, bodies, catalog);
    const script = renameScript(r, parts);
    await deps.consoles.openNew(conn);
    await deps.consoles.rename(`rename · ${labelOf(r)}`);
    const now = deps.view.editor().text;
    deps.view.replace(0, now.length, script);
    deps.consoles.edited(script);
    deps.view.select(0, 0);
    deps.say(
      `The rename's script is in a console, not run: ${parts.replaced.length} rewritten, ` +
        `${parts.kept.length} follow by themselves, ${parts.checks.length} to check by hand.`,
    );
    return {
      script,
      rewritten: parts.replaced.length,
      kept: parts.kept.length,
      checks: parts.checks.length,
    };
  };

  return {
    /** Rename the name at the caret: in the statement, or on the server through a script. */
    async rename(/** @type {Record<string, unknown>} */ args = {}) {
      const { conn, view, w, names } = await here();
      let target = targetAt(w.text, names, w.caret);
      if (!target) {
        const typeIn = (/** @type {string | undefined} */ schema, /** @type {string} */ name) =>
          (schema ? [schema] : ["public"]).find((s) =>
            view.objects(s)?.some((o) => o.kind === "type" && o.name === name),
          ) ?? null;
        const hit = aimAt(names, w.text, w.caret, typeIn);
        target = hit ? { object: hit.aim } : null;
      }
      if (!target) throw new Error(NOTHING);
      if ("reason" in target) throw new Error(target.reason);
      if ("object" in target) return renameObject(conn, target.object, args);
      const { local } = target;
      const to = await nameFor(args.to, local.name, local.name);
      if (to === undefined) return undefined;
      const done = renameLocal(w.text, names, local, to);
      if (typeof done === "string") throw new Error(done);
      apply(w, done.text);
      deps.say(
        `Renamed ${local.name} to ${to} in ${done.places} place${done.places === 1 ? "" : "s"}.`,
      );
      return { text: done.text };
    },

    /** Rename a server object a command names (agents, the palette). */
    async renameNamed(/** @type {Record<string, unknown>} */ args) {
      const conn = await deps.manager.choose(
        typeof args.connection === "string" ? args.connection : undefined,
        "Database: which connection?",
      );
      if (!conn) return undefined;
      if (conn.engine !== "postgresql") throw new Error(NOT_PG);
      const s = (/** @type {string} */ k) =>
        typeof args[k] === "string" ? /** @type {string} */ (args[k]) : "";
      const kind = s("kind");
      /** @type {Aim} */
      const aim =
        kind === "column"
          ? { kind: "column", schema: s("schema") || "public", table: s("table"), name: s("name") }
          : kind === "schema"
            ? { kind: "schema", name: s("name") }
            : kind === "function" || kind === "procedure"
              ? { kind: "function", schema: s("schema") || "public", name: s("name") }
              : kind === "type" || kind === "domain"
                ? { kind: "type", schema: s("schema") || "public", name: s("name") }
                : {
                    kind: "relation",
                    schema: s("schema") || "public",
                    name: s("name"),
                    relkind: kind,
                  };
      if (!aim.name) throw new Error("Name the object to rename.");
      return renameObject(conn, aim, args);
    },

    /** Make the FROM subquery at the caret a CTE. */
    async extract(/** @type {Record<string, unknown>} */ args = {}) {
      const { w, names } = await here();
      let done = extractCte(
        w.text,
        names,
        w.caret,
        typeof args.name === "string" ? typed(args.name) : undefined,
      );
      if (done === "Name the subquery: give it an alias first.") {
        const name = await nameFor(undefined, "the subquery's CTE", "sub");
        if (name === undefined) return undefined;
        done = extractCte(w.text, names, w.caret, name);
      }
      if (typeof done === "string") throw new Error(done);
      apply(w, done.text);
      deps.say(`The subquery is the CTE ${done.name}.`);
      return { text: done.text };
    },

    /** Inline the CTE at the caret where it is used. */
    async inline() {
      const { w, names } = await here();
      const target = targetAt(w.text, names, w.caret);
      if (!target || !("local" in target) || target.local.kind !== "cte")
        throw new Error("Put the caret on a CTE's name.");
      const done = inlineCte(w.text, names, target.local.at);
      if (typeof done === "string") throw new Error(done);
      apply(w, done.text);
      deps.say(`${done.name} is inlined.`);
      return { text: done.text };
    },

    /** Qualify every name of the statement at the caret. */
    async qualify() {
      const { w, names } = await here();
      const done = qualifyNames(w.text, names);
      if (done.places) apply(w, done.text);
      const unsure = done.unsure
        ? `; ${done.unsure} left as written: their FROM item could not be told`
        : "";
      deps.say(`${done.places} name${done.places === 1 ? "" : "s"} qualified${unsure}.`);
      return { text: done.text };
    },
  };
}
