// What each operation's dialog asks (PG-52): its fields (a new name, a schema, an owner, a comment,
// a trigger's state) filled from what was read or what a command was given, its choices (CASCADE,
// RESTART IDENTITY, CONCURRENTLY, WITH NO DATA) never on unless given, what depends on the object,
// and the notes that say what the statement does beyond its words. The dialog writes the script
// from the same model (statements.js), so it is data only. Pure.

import { ENGINE_NAMES, OPS, said } from "./kinds.js";

/**
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("./kinds.js").Target} Target
 * @typedef {import("./sql-postgres.js").AnyOp} AnyOp
 * @typedef {import("./sql-postgres.js").Facts} Facts
 * @typedef {{ name: string, label: string, kind: "text" | "select" | "textarea", value: string, options?: string[], list?: string[], hint?: string }} Field
 * @typedef {{ name: string, label: string, hint: string, checked: boolean, disabled?: boolean }} Choice
 * @typedef {{
 *   engine: import("../../engines/common.js").EngineId, op: AnyOp, target: Target, facts: Facts,
 *   title: string, where: string, tag: string, fields: Field[], choices: Choice[],
 *   dependents: Facts["dependents"] | null, notes: string[], run: string, danger: boolean,
 * }} OperationModel
 */

/** The dialog type every operation asks with. */
export const DIALOG = "object-operation";

const ENABLED = { O: "enabled", D: "disabled", R: "enabled on replicas only", A: "always enabled" };
/** The dialog's button, by operation. */
const RUN = {
  rename: "Rename",
  move: "Move",
  owner: "Change owner",
  comment: "Save comment",
  drop: "Drop",
  truncate: "Truncate",
  refresh: "Refresh",
  enable: "Apply",
  apply: "Apply",
};
const yes = (/** @type {unknown} */ value) => value === true || value === "true";

/** A routine's own name, without its arguments. */
const ownName = (/** @type {Target} */ target, /** @type {Facts} */ facts) =>
  facts.routine?.name ?? target.name.replace(/\(.*$/su, "");

/**
 * @param {Connection} conn
 * @param {AnyOp} op
 * @param {Target} target
 * @param {Facts} facts
 * @param {Record<string, unknown>} given A command's arguments, which fill the fields.
 * @param {string[]} [schemas] Where an object can move to.
 * @returns {OperationModel}
 */
export function modelOf(conn, op, target, facts, given, schemas = []) {
  const pg = conn.engine === "postgresql";
  const text = (/** @type {string} */ key) =>
    typeof given[key] === "string" ? /** @type {string} */ (given[key]) : undefined;
  const object = said(conn.engine, target);
  const verb = op === "apply" ? "Apply the source of" : OPS[op].label.replace(/…$/u, "");
  /** @type {Field[]} */
  const fields = [];
  /** @type {Choice[]} */
  const choices = [];
  /** @type {string[]} */
  const notes = [];
  if (op === "rename") {
    fields.push({
      name: "to",
      label: "New name",
      kind: "text",
      value: text("to") ?? ownName(target, facts),
      hint: "Written as typed, in quotes: its case and spaces are kept.",
    });
    if (pg && (target.kind === "table" || target.kind === "view"))
      notes.push("Views and keys follow it; a function body that names it does not.");
  }
  if (op === "move") {
    const options = schemas.filter((s) => s !== target.schema);
    fields.push({
      name: "to",
      label: conn.engine === "mysql" ? "Database" : "Schema",
      kind: "select",
      value: text("to") ?? options[0] ?? "",
      options,
    });
  }
  if (op === "owner") {
    fields.push({
      name: "to",
      label: "New owner",
      kind: "text",
      value: text("to") ?? "",
      list: facts.roles ?? [],
    });
    if (facts.owner) notes.push(`${facts.owner} owns it now.`);
  }
  if (op === "comment")
    fields.push({
      name: "comment",
      label: "Comment",
      kind: "textarea",
      value: text("comment") ?? facts.comment ?? "",
      hint: conn.engine === "mysql" ? "Empty leaves no comment." : "Empty removes the comment.",
    });
  if (op === "drop") dropParts(conn, target, facts, given, choices, notes);
  if (op === "truncate") truncateParts(conn, facts, given, choices, notes);
  if (op === "refresh") {
    const can = facts.populated !== false && facts.unique === true;
    choices.push({
      name: "concurrently",
      label: "CONCURRENTLY",
      hint: can
        ? "Reads go on while it refreshes."
        : "Needs data and a unique index on plain columns that covers every row: not here.",
      checked: can && given.concurrently !== false,
      disabled: !can,
    });
    choices.push({
      name: "nodata",
      label: "WITH NO DATA",
      hint: "Empties it; it cannot be read until the next refresh.",
      checked: yes(given.withNoData),
    });
  }
  if (op === "enable") {
    const now = facts.enabled ?? "O";
    const wanted = typeof given.enabled === "boolean" ? given.enabled : now === "D";
    fields.push({
      name: "state",
      label: "Trigger",
      kind: "select",
      value: wanted ? "enable" : "disable",
      options: ["enable", "disable"],
    });
    notes.push(`It is ${ENABLED[/** @type {keyof typeof ENABLED} */ (now)] ?? "enabled"} now.`);
  }
  if (op === "apply") notes.push(...applyNotes(conn, target));
  return {
    engine: conn.engine,
    op,
    target,
    facts,
    title: `${verb} ${object}`,
    where: `${conn.name} · ${ENGINE_NAMES[conn.engine]}`,
    tag: conn.tag === "none" ? "" : conn.tag,
    fields,
    choices,
    dependents: facts.dependents ?? null,
    notes,
    run: /** @type {Record<string, string>} */ (RUN)[op] ?? "Run",
    danger: op === "drop" || op === "truncate",
  };
}

/** A drop's CASCADE (PostgreSQL's) and what the engine cannot say. */
function dropParts(
  /** @type {Connection} */ conn,
  /** @type {Target} */ target,
  /** @type {Facts} */ facts,
  /** @type {Record<string, unknown>} */ given,
  /** @type {Choice[]} */ choices,
  /** @type {string[]} */ notes,
) {
  if (conn.engine !== "postgresql") {
    notes.push(
      `${ENGINE_NAMES[conn.engine]} keeps no list of what depends on it: views and triggers that use it stop working.`,
    );
    return;
  }
  const blocking = facts.dependents?.blocking.length ?? 0;
  choices.push({
    name: "cascade",
    label: "CASCADE",
    hint: blocking
      ? blocking === 1
        ? "Also drops the object that depends on it."
        : `Also drops the ${blocking} objects that depend on it.`
      : "Nothing depends on it now; CASCADE would drop what does by the time it runs.",
    checked: yes(given.cascade),
  });
  if (blocking) notes.push("Without CASCADE the server refuses while anything depends on it.");
  if (target.kind === "schema") notes.push("CASCADE drops every object in the schema.");
}

/** A truncate's options, with the row estimate and the tables its foreign keys meet. */
function truncateParts(
  /** @type {Connection} */ conn,
  /** @type {Facts} */ facts,
  /** @type {Record<string, unknown>} */ given,
  /** @type {Choice[]} */ choices,
  /** @type {string[]} */ notes,
) {
  const rows = facts.rows;
  if (typeof rows === "number")
    notes.push(`About ${rows.toLocaleString("en-US")} rows (the server's estimate) go.`);
  else if (conn.engine === "postgresql")
    notes.push("The server has no estimate of its rows yet: it was not analyzed.");
  if (conn.engine === "sqlite") {
    notes.push("SQLite has no TRUNCATE: DELETE FROM removes every row.");
    return;
  }
  if (conn.engine === "mysql") {
    notes.push("MySQL commits a TRUNCATE at once: it cannot be rolled back.");
    return;
  }
  const sequences = facts.sequences ?? [];
  choices.push({
    name: "restart",
    label: "RESTART IDENTITY",
    hint: sequences.length
      ? `Starts ${sequences.join(", ")} again.`
      : "It owns no sequence: nothing starts again.",
    checked: yes(given.restartIdentity),
  });
  const referencing = facts.referencing ?? [];
  choices.push({
    name: "cascade",
    label: "CASCADE",
    hint: referencing.length
      ? `Also empties ${referencing.join(", ")}, whose foreign keys point here.`
      : "No other table's foreign key points here.",
    checked: yes(given.cascade),
  });
  if (referencing.length)
    notes.push("Without CASCADE the server refuses: other tables point here.");
  notes.push("ON DELETE triggers do not fire; TRUNCATE triggers do.");
}

/** What applying a source does beyond its text. */
function applyNotes(/** @type {Connection} */ conn, /** @type {Target} */ target) {
  if (conn.engine === "sqlite")
    return [
      "SQLite has no CREATE OR REPLACE: the view is dropped and created again in one transaction.",
    ];
  if (conn.engine === "mysql") return ["MySQL commits DDL at once: it cannot be rolled back."];
  if (target.kind === "materialized view")
    return [
      "A materialized view has no CREATE OR REPLACE: it is dropped and created again in one transaction, with the indexes and the comment the text writes.",
      "Its grants are not kept: grant them again after.",
    ];
  if (target.kind === "view")
    return [
      "CREATE OR REPLACE keeps its grants; it can add columns at the end, not drop or rename them.",
    ];
  return ["CREATE OR REPLACE keeps its grants; other arguments make another routine."];
}
