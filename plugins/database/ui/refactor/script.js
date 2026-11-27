// The script of an object's rename (PG-33), for the person to read before it runs: a header that
// says what it rewrote, what follows the rename by itself and what to check by hand, then one
// transaction. The rewritten routines come first, replaced with function bodies unchecked (their
// header still names the objects by what the server holds, which the ALTER then renames), and the
// ALTER last. Pure.

import { t } from "../strings/index.js";
import { written } from "./syntax.js";

/**
 * @typedef {import("./bodies.js").Rename} Rename
 * @typedef {import("../navigate/usages.js").Usage} Usage
 * @typedef {{ label: string, definition: string }} Replaced
 * @typedef {{ label: string, line?: number, why: string }} Check
 * @typedef {{ replaced: Replaced[], kept: Usage[], checks: Check[], capped?: boolean }} Parts
 */

const q = (/** @type {string} */ schema, /** @type {string} */ name) =>
  `${written(schema)}.${written(name)}`;

/** The words of ALTER for a relation of the schema cache's kind. */
const WORDS = /** @type {Record<string, string>} */ ({
  table: "TABLE",
  "partitioned table": "TABLE",
  view: "VIEW",
  "materialized view": "MATERIALIZED VIEW",
  sequence: "SEQUENCE",
  "foreign table": "FOREIGN TABLE",
});

/** What the rename is of, as the header and the console's title say it. */
export function labelOf(/** @type {Rename} */ r) {
  if (r.kind === "column") return `${r.schema}.${r.table}.${r.name}`;
  if (r.kind === "function") return `${r.schema}.${r.name}(${r.args})`;
  if (r.kind === "schema") return r.name;
  return `${r.schema}.${r.name}`;
}

/** The ALTER statement that renames. */
export function alterOf(/** @type {Rename} */ r) {
  const to = written(r.to);
  if (r.kind === "relation")
    return `ALTER ${WORDS[r.relkind] ?? "TABLE"} ${q(r.schema, r.name)} RENAME TO ${to};`;
  if (r.kind === "column")
    return `ALTER ${WORDS[r.relkind] ?? "TABLE"} ${q(r.schema, r.table)} RENAME COLUMN ${written(r.name)} TO ${to};`;
  if (r.kind === "function")
    return `ALTER ${r.routine === "procedure" ? "PROCEDURE" : "FUNCTION"} ${q(r.schema, r.name)}(${r.args}) RENAME TO ${to};`;
  if (r.kind === "type")
    return `ALTER ${r.domain ? "DOMAIN" : "TYPE"} ${q(r.schema, r.name)} RENAME TO ${to};`;
  return `ALTER SCHEMA ${written(r.name)} RENAME TO ${to};`;
}

/** A usage of the dependency catalog's as a header line. */
function keptLine(/** @type {Usage} */ u) {
  const on = u.table ? ` on ${u.table}` : "";
  const args = u.kind === "function" || u.kind === "procedure" ? `(${u.detail ?? ""})` : "";
  return `${u.kind} ${u.schema}.${u.name}${args}${on}`;
}

/** A comment line: nothing in it closes or opens anything. */
const comment = (/** @type {string} */ text) => `-- ${text.replace(/\r?\n/gu, " ")}`.trimEnd();

/**
 * The header's lines, which say plainly what the script does to each dependent.
 * @param {Rename} r
 * @param {Parts} parts
 */
export function headerOf(r, parts) {
  const lines = [
    t("refactor.script.renameToNothingHasRun", { value: String(labelOf(r)), to: String(r.to) }),
    t("refactor.script.readItThenRunItIn"),
    "",
    t("refactor.script.rewrittenHereRoutineBodiesTheServer", {
      length: String(parts.replaced.length),
    }),
    ...parts.replaced.map((p) => `  ${p.label}`),
    t("refactor.script.followTheRenameByThemselvesThe", { length: String(parts.kept.length) }),
    ...parts.kept.map((u) => `  ${keptLine(u)}`),
  ];
  if (
    r.kind === "column" &&
    parts.kept.some((u) => u.kind === "view" || u.kind === "materialized view")
  )
    lines.push(t("refactor.script.aViewKeepsAsTheName", { name: String(r.name) }));
  if (r.kind === "schema") lines.push(t("refactor.script.everyObjectInTheSchemaAnd"));
  lines.push(t("refactor.script.checkByHandWhatCannotBe", { length: String(parts.checks.length) }));
  for (const c of parts.checks)
    lines.push(`  ${c.label}${c.line ? `, line ${c.line}` : ""}: ${c.why}`);
  if (parts.capped) lines.push(t("refactor.script.moreRoutinesNameItThanWere"));
  return lines.map(comment);
}

/**
 * The whole script.
 * @param {Rename} r
 * @param {Parts} parts
 */
export function renameScript(r, parts) {
  const body = [
    "BEGIN;",
    ...(parts.replaced.length ? ["SET LOCAL check_function_bodies = off;", ""] : []),
    ...parts.replaced.flatMap((p) => [`${p.definition.trimEnd()};`, ""]),
    alterOf(r),
    "COMMIT;",
  ];
  return `${[...headerOf(r, parts), "", ...body].join("\n")}\n`;
}
