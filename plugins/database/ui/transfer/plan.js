// What a copy runs (PG-63), made from what it read: tables in their foreign keys' order, each one's
// structure (ddl.js) and its rows as a COPY out of the source and a COPY in to the target with the
// same column list (generated columns left out on both sides); a query's result into a new table or
// appended to an existing one by a column mapping. The report (compare.js) comes with it, and the
// script the target's side will run, for the person to read first. No DOM.

import { qualified, quoteName } from "../sql/quote.js";
import { t } from "../strings/index.js";
import { differences } from "./compare.js";
import { keyOf, queryTable, structureOf } from "./ddl.js";
import { foreignKeyOrder } from "./order.js";

/**
 * @typedef {import("../engines/common.js").Connection} Connection
 * @typedef {import("./ddl.js").TableDef} TableDef
 * @typedef {import("./ddl.js").Name} Name
 * @typedef {import("./read.js").TargetFacts} TargetFacts
 * @typedef {import("./read.js").Version} Version
 * @typedef {import("./compare.js").Content} Content
 * @typedef {import("./compare.js").Report} Report
 * @typedef {{ schema: string, name?: string, content: Content, foreignKeys: boolean }} TableChoice
 *   `name` renames the one table copied.
 * @typedef {{ schema: string, name: string, append: boolean, mapping?: Record<string, string> }} QueryChoice
 *   `mapping` takes each result column to a target column ("" leaves it out), on an append.
 * @typedef {{ source: string, target: string, out: string, in: string }} Step
 *   One table's rows: `out` runs on the source, `in` on the target.
 * @typedef {{ setup: string, steps: Step[], keys: string, after: string, report: Report, snapshot: boolean }} Plan
 */

const pq = (/** @type {string} */ s) => quoteName("postgresql", s);
const at = (/** @type {Name} */ n) => qualified("postgresql", n.schema, n.name);
const shown = (/** @type {Name} */ n) => `${n.schema}.${n.name}`;
const schemaSql = (/** @type {string} */ s) => `CREATE SCHEMA IF NOT EXISTS ${pq(s)};\n`;

/** The script the target's side runs, as the panel shows it. */
export function scriptOf(/** @type {Plan} */ plan) {
  return [
    "BEGIN;",
    plan.setup.trimEnd(),
    ...plan.steps.map((s) => `${s.in};`),
    plan.keys.trimEnd(),
    plan.after.trimEnd(),
    "COMMIT;",
  ]
    .filter((part) => part !== "")
    .join("\n\n");
}

/**
 * A copy of tables.
 * @param {TableDef[]} defs
 * @param {TableChoice} choice
 * @param {{ source: Version, target: TargetFacts }} facts
 * @returns {Plan}
 */
export function planTables(defs, choice, facts) {
  const copies = new Map(
    defs.map((d) => [
      keyOf(d.schema, d.name),
      { schema: choice.schema, name: defs.length === 1 && choice.name ? choice.name : d.name },
    ]),
  );
  const byKey = new Map(defs.map((d) => [keyOf(d.schema, d.name), d]));
  const order = foreignKeyOrder(
    defs.map((d) => ({
      key: keyOf(d.schema, d.name),
      needs: d.keys.map((k) => keyOf(k.schema, k.table)),
    })),
  );
  const structure = choice.content !== "data";
  const data = choice.content !== "structure";
  const setup = [];
  const keys = [];
  const after = [];
  const notes = [];
  /** @type {Step[]} */
  const steps = [];
  /** @type {import("./compare.js").ColumnPair[]} */
  const columns = [];
  const tables = [];
  for (const key of order) {
    const def = /** @type {TableDef} */ (byKey.get(key));
    const target = /** @type {Name} */ (copies.get(key));
    const made = structureOf(def, target, { foreignKeys: choice.foreignKeys, copies });
    const held = facts.target.tables.get(keyOf(target.schema, target.name));
    tables.push({ label: shown(target), exists: held !== undefined });
    if (structure) {
      setup.push(made.create);
      keys.push(made.keys);
      notes.push(...made.notes);
    }
    if (!data) continue;
    if (structure) after.push(made.after);
    else if (held)
      for (const row of def.columns.filter((r) => !r[5]))
        columns.push({
          table: shown(target),
          column: row[0] ?? "",
          source: row[1] ?? "",
          target: held?.find((c) => c.name === row[0] && !c.generated)?.type ?? null,
        });
    const list = made.columns.join(", ");
    steps.push({
      source: shown(def),
      target: shown(target),
      out: `COPY (SELECT ${list} FROM ${at(def)}) TO STDOUT`,
      in: `COPY ${at(target)} (${list}) FROM STDIN`,
    });
  }
  const newSchemas =
    structure && !facts.target.schemas.includes(choice.schema) ? [choice.schema] : [];
  const report = differences({
    source: facts.source,
    target: facts.target.version,
    content: choice.content,
    missingTypes: facts.target.missing,
    newSchemas,
    tables: data || structure ? tables : [],
    columns,
    notes,
  });
  return {
    setup: [...newSchemas.map(schemaSql), ...setup].join("\n"),
    steps,
    keys: keys.join(""),
    after: after.join(""),
    report,
    snapshot: steps.length > 1,
  };
}

/** The type without its modifiers: `numeric(10,2)` is `numeric`. */
const base = (/** @type {string} */ type) => type.replace(/\(.*?\)/u, "");

/**
 * A query's result into a new table, or appended to an existing one.
 * @param {string} query
 * @param {{ name: string, type: string }[]} described
 * @param {QueryChoice} choice
 * @param {{ source: Version, target: TargetFacts }} facts
 * @returns {Plan}
 */
export function planQuery(query, described, choice, facts) {
  const target = { schema: choice.schema, name: choice.name };
  const body = query.trim().replace(/;+$/u, "").trimEnd();
  const held = facts.target.tables.get(keyOf(target.schema, target.name));
  const problems = [];
  const names = described.map((c) => c.name);
  const twice = names.find((n, i) => names.indexOf(n) !== i);
  if (twice !== undefined)
    problems.push(t("transfer.plan.theQueryAnswersTwoColumnsNamed", { twice: String(twice) }));
  const columns = [];
  /** @type {{ source: string, target: string }[]} */
  let pairs = described.map((c) => ({ source: c.name, target: c.name }));
  if (choice.append) {
    const map = choice.mapping ?? {};
    pairs = described
      .map((c) => ({ source: c.name, target: c.name in map ? (map[c.name] ?? "") : c.name }))
      .filter((p) => p.target !== "");
    if (held)
      for (const pair of pairs) {
        const own = held.find((c) => c.name === pair.target && !c.generated);
        const type = described.find((c) => c.name === pair.source)?.type ?? "";
        columns.push({
          table: shown(target),
          column: pair.target,
          source: type,
          target: own ? base(own.type) : null,
        });
      }
    const targets = pairs.map((p) => p.target);
    const again = targets.find((n, i) => targets.indexOf(n) !== i);
    if (again !== undefined)
      problems.push(t("transfer.plan.twoResultColumnsGoIntoMap", { again: String(again) }));
    if (pairs.length === 0) problems.push(t("transfer.plan.noResultColumnGoesIntoThe"));
  }
  const newSchemas =
    !choice.append && !facts.target.schemas.includes(choice.schema) ? [choice.schema] : [];
  const report = differences({
    source: facts.source,
    target: facts.target.version,
    content: choice.append ? "data" : "both",
    missingTypes: choice.append ? [] : facts.target.missing,
    newSchemas,
    tables: [{ label: shown(target), exists: held !== undefined }],
    columns,
  });
  report.problems.unshift(...problems);
  const from = pairs.map((p) => pq(p.source)).join(", ");
  const into = pairs.map((p) => pq(p.target)).join(", ");
  const whole = !choice.append;
  return {
    setup: [...newSchemas.map(schemaSql), ...(whole ? [queryTable(described, target)] : [])].join(
      "\n",
    ),
    steps: [
      {
        source: "the query",
        target: shown(target),
        out: whole
          ? `COPY (${body}\n) TO STDOUT`
          : `COPY (SELECT ${from} FROM (${body}\n) AS q) TO STDOUT`,
        in: `COPY ${at(target)} (${into}) FROM STDIN`,
      },
    ],
    keys: "",
    after: "",
    report,
    snapshot: false,
  };
}
