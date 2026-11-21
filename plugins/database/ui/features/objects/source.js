// A view's, a materialized view's, a routine's or a trigger function's source edited in a console
// (PG-52): the definition read from the server (a MySQL view's as CREATE OR REPLACE, a materialized
// view's with its comment) into a new console named after the object, or the one already open for
// it. Apply reads that console's text, shows the script (a materialized view dropped first, a
// SQLite view too) and runs it in the console in one transaction where the engine can roll DDL
// back; an error selects its line. A materialized view others depend on is refused first. No DOM.

import { engineOf } from "../../engines/index.js";
import { closeStatement } from "../../schema/common.js";
import { qualified, quoteText } from "../../sql/quote.js";
import { split } from "../../sql/split.js";
import { answersOf } from "./checks.js";
import { readFacts } from "./facts.js";
import { notOffered, said } from "./kinds.js";
import { DIALOG, modelOf } from "./models.js";
import { applyPrefix, modeOf, scriptOf } from "./statements.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("./kinds.js").Target} Target
 * @typedef {{ target: Target, of: string }} ObjectSource
 *   What a console holds the source of (`objectSource` on the console), and how it is said.
 */

const same = (/** @type {Target} */ a, /** @type {Target} */ b) =>
  a.kind === b.kind && a.schema === b.schema && a.name === b.name;

/** The definition to edit and what it is the definition of. */
async function definitionOf(
  /** @type {Deps} */ deps,
  /** @type {Connection} */ conn,
  /** @type {Target} */ target,
) {
  if (target.kind === "trigger") {
    const facts = await readFacts(deps, conn, "source", target);
    if (!facts.source || !facts.fn)
      throw new Error(`The function of ${said(conn.engine, target)} was not read.`);
    return {
      text: closeStatement(facts.source),
      of: facts.fn,
      label: `${said(conn.engine, facts.fn)} (of ${said(conn.engine, target)})`,
    };
  }
  const object = { ...target, detail: "", rows: null, ident: target.ident ?? "" };
  let text = await deps.catalog.ddl(conn, /** @type {never} */ (object));
  if (conn.engine === "mysql")
    text = text.replace(/^\s*CREATE\s+(?!OR\s+REPLACE\b)/iu, "CREATE OR REPLACE ");
  if (conn.engine === "postgresql" && target.kind === "materialized view") {
    const { comment } = await readFacts(deps, conn, "comment", target);
    const name = qualified("postgresql", target.schema, target.name);
    if (comment)
      text += `\nCOMMENT ON MATERIALIZED VIEW ${name} IS ${quoteText("postgresql", comment)};\n`;
  }
  return { text, of: target, label: said(conn.engine, target) };
}

/** Open an object's source in a console of its own (the one open for it, when there is one). */
export async function openSource(
  /** @type {Deps} */ deps,
  /** @type {Connection} */ conn,
  /** @type {Target} */ target,
) {
  const refused = notOffered(conn.engine, "source", target);
  if (refused) throw new Error(refused);
  const { text, of, label } = await definitionOf(deps, conn, target);
  const open = deps.consoles
    .list()
    .find(
      (c) =>
        c.kind === "console" &&
        c.connection === conn.id &&
        c.objectSource &&
        same(c.objectSource.target, of),
    );
  if (open) {
    deps.consoles.show(open.id);
    deps.say(`The source of ${label} is open here with its edits.`);
    return deps.view.editor().text;
  }
  const shown = await deps.consoles.openNew(conn);
  /** @type {ObjectSource} */
  const source = { target: of, of: label };
  shown.objectSource = source;
  shown.text = text;
  await deps.consoles.rename(`source · ${said(conn.engine, of)}`);
  const now = deps.view.editor().text;
  if (now !== text) deps.view.replace(0, now.length, text);
  deps.consoles.edited(text);
  deps.view.select(0, 0);
  deps.say(
    `The source of ${label}: edit it, then Database: apply the source shows the script and runs it.`,
  );
  return text;
}

/** Where a line starts and ends around an offset, and its number. */
export function lineAt(/** @type {string} */ text, /** @type {number} */ offset) {
  const at = Math.max(0, Math.min(offset, text.length));
  const from = text.lastIndexOf("\n", at - 1) + 1;
  const end = text.indexOf("\n", at);
  const line = text.slice(0, from).split("\n").length;
  return { from, to: end < 0 ? text.length : end, line };
}

/** Apply the source in the console on screen: the script shown first, an error's line selected. */
export async function applySource(/** @type {Deps} */ deps) {
  const shown = deps.consoles.current();
  /** @type {ObjectSource | undefined} */
  const source = shown?.objectSource;
  if (shown?.kind !== "console" || !source)
    throw new Error(
      "This console holds no object's source: open one with s in the explorer (Database: edit the source).",
    );
  const conn = deps.manager.get(shown.connection);
  if (!conn) throw new Error("This console's connection was removed.");
  if (conn.readOnly)
    throw new Error(`${conn.name} is read-only: objects are not changed from here.`);
  const { target } = source;
  const { text } = deps.view.editor();
  const facts = { ...(await readFacts(deps, conn, "apply", target)), text };
  const blocking = facts.dependents?.blocking ?? [];
  if (blocking.length)
    throw new Error(
      `Not applied: ${blocking.map((d) => `${d.kind} ${d.name}`).join(", ")} ${
        blocking.length === 1 ? "depends" : "depend"
      } on it, and a materialized view is dropped and created again: drop or change ${
        blocking.length === 1 ? "it" : "them"
      } first.`,
    );
  const answer = await deps.dialog(DIALOG, modelOf(conn, "apply", target, facts, {}));
  if (answer === undefined) throw deps.cancelled("Not applied.");
  const script = scriptOf(conn.engine, "apply", target, facts, answersOf(answer));
  const { dialect } = engineOf(conn.engine);
  const before = split(applyPrefix(conn.engine, target, facts), dialect).map((s) => ({
    ...s,
    start: 0,
    end: 0,
    line: 1,
    column: 1,
  }));
  const statements = [...before, ...split(text, dialect)];
  await deps.consoles.runIn(shown, conn, script, {
    mode: modeOf(conn.engine),
    statements,
    base: 0,
  });
  const result = shown.execution?.result;
  const failed = result?.error ?? result?.statements.find((s) => s.error)?.error;
  if (failed) {
    const error = shown.shown?.error;
    const at = error && error.statement >= before.length ? lineAt(text, error.offset) : undefined;
    if (at) deps.view.select(at.from, at.to);
    throw new Error(`Not applied: ${failed.message}${at ? ` (line ${at.line})` : ""}`);
  }
  deps.say(`Applied the source of ${source.of}.`);
  return { script };
}
