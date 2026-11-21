// PostgreSQL's statements for the explorer's operations (PG-52), written from the kind's row in
// kinds.js, what was read of the object (facts.js) and the dialog's answers: every name quoted,
// a routine named by its identity arguments, a trigger or a constraint on its table, CASCADE and
// the other options only when chosen. A source edit runs the console's text as it is, after a
// DROP for a materialized view, which has no CREATE OR REPLACE. Pure.

import { qualified, quoteName, quoteText } from "../../sql/quote.js";
import { newName } from "./checks.js";
import { kindSql } from "./kinds.js";

/**
 * @typedef {import("./kinds.js").Target} Target
 * @typedef {import("./kinds.js").Op | import("./kinds.js").ApplyOp} AnyOp
 * @typedef {{ values: Record<string, string>, choices: string[] }} Answers
 * @typedef {{ name: string, mode: "in" | "out" | "inout" | "variadic" }} Param
 * @typedef {{ name: string, args: string, params: Param[] }} Routine
 *   A routine as its DDL names it: `name`, its identity arguments, and each argument for a call.
 * @typedef {{ kind: string, name: string }} Dependent
 * @typedef {{ blocking: Dependent[], along: Dependent[], more: number }} Dependents
 *   What a plain DROP is refused for (CASCADE drops it too), what goes with the object anyway,
 *   and how many more there are than listed.
 * @typedef {{
 *   routine?: Routine, comment?: string | null, owner?: string, roles?: string[],
 *   schemas?: string[], dependents?: Dependents, referencing?: string[], sequences?: string[],
 *   rows?: number | null, populated?: boolean, unique?: boolean, enabled?: string, text?: string,
 * }} Facts
 *   What was read of the object before its dialog: `enabled` is pg_trigger.tgenabled, `unique` a
 *   unique index CONCURRENTLY can use, `text` the source a console holds.
 */

const PG = "postgresql";
const q = (/** @type {string} */ name) => quoteName(PG, name);
const tableOf = (/** @type {Target} */ t) => qualified(PG, t.schema, t.table ?? "");

/** How the object is named in its DDL. */
export function postgresRef(/** @type {Target} */ target, /** @type {Facts} */ facts) {
  const spec = kindSql(PG, target.kind);
  if (target.kind === "schema") return q(target.name);
  if (spec?.routine) {
    const routine = facts.routine;
    if (!routine) throw new Error(`The arguments of ${target.name} were not read.`);
    return `${qualified(PG, target.schema, routine.name)}(${routine.args})`;
  }
  if (spec?.on) return `${q(target.name)} ON ${tableOf(target)}`;
  return qualified(PG, target.schema, target.name);
}

/** Why an index cannot be dropped alone: a constraint owns it. */
export const ownedWords = (/** @type {Target} */ target) =>
  `${target.name} is the index of a constraint of ${target.table}: drop the constraint (under Keys) instead.`;

/**
 * The statement of an operation.
 * @param {AnyOp} op
 * @param {Target} target
 * @param {Facts} facts
 * @param {Answers} answers
 */
export function postgresScript(op, target, facts, answers) {
  const spec = kindSql(PG, target.kind);
  if (!spec) throw new Error(`A ${target.kind} is not changed from here.`);
  const { values } = answers;
  const chosen = new Set(answers.choices);
  const ref = postgresRef(target, facts);
  const cascade = chosen.has("cascade") ? " CASCADE" : "";
  switch (op) {
    case "rename": {
      const to = q(newName(PG, values.to, target.name));
      if (spec.constraint)
        return `ALTER TABLE ${tableOf(target)} RENAME CONSTRAINT ${q(target.name)} TO ${to};`;
      return `ALTER ${spec.word} ${ref} RENAME TO ${to};`;
    }
    case "move":
      return `ALTER ${spec.word} ${ref} SET SCHEMA ${q(newName(PG, values.to, target.schema, "schema"))};`;
    case "owner":
      return `ALTER ${spec.word} ${ref} OWNER TO ${q(newName(PG, values.to, facts.owner ?? "", "owner"))};`;
    case "comment": {
      const text = values.comment ?? "";
      return `COMMENT ON ${spec.word} ${ref} IS ${text === "" ? "NULL" : quoteText(PG, text)};`;
    }
    case "drop":
      if (target.owned) throw new Error(ownedWords(target));
      if (spec.constraint)
        return `ALTER TABLE ${tableOf(target)} DROP CONSTRAINT ${q(target.name)}${cascade};`;
      return `DROP ${spec.word} ${ref}${cascade};`;
    case "truncate":
      return `TRUNCATE TABLE ${ref}${chosen.has("restart") ? " RESTART IDENTITY" : ""}${cascade};`;
    case "refresh":
      return refreshSql(ref, facts, chosen);
    case "enable": {
      const how = values.state === "disable" ? "DISABLE" : "ENABLE";
      return `ALTER TABLE ${tableOf(target)} ${how} TRIGGER ${q(target.name)};`;
    }
    case "apply":
      return `${postgresPrefix(target, facts)}${sourceText(facts)}`;
    default:
      throw new Error(`${op} writes no statement.`);
  }
}

/** REFRESH MATERIALIZED VIEW, CONCURRENTLY only where the server allows it. */
function refreshSql(
  /** @type {string} */ ref,
  /** @type {Facts} */ facts,
  /** @type {Set<string>} */ chosen,
) {
  const concurrently = chosen.has("concurrently");
  const empty = chosen.has("nodata");
  if (concurrently && empty)
    throw new Error("CONCURRENTLY refreshes with data: it cannot go with WITH NO DATA.");
  if (concurrently && facts.populated === false)
    throw new Error(
      "CONCURRENTLY needs a materialized view that has data: refresh it once without.",
    );
  if (concurrently && !facts.unique)
    throw new Error(
      "CONCURRENTLY needs a unique index on plain columns that covers every row: there is none.",
    );
  return `REFRESH MATERIALIZED VIEW ${concurrently ? "CONCURRENTLY " : ""}${ref}${empty ? " WITH NO DATA" : ""};`;
}

/** What runs before a source's text: the DROP a materialized view needs, else nothing. */
export function postgresPrefix(/** @type {Target} */ target, /** @type {Facts} */ facts) {
  if (target.kind !== "materialized view") return "";
  return `DROP MATERIALIZED VIEW ${postgresRef(target, facts)};\n`;
}

/** The console's text, refused when it holds nothing. */
export function sourceText(/** @type {Facts} */ facts) {
  const text = facts.text ?? "";
  if (text.trim() === "") throw new Error("The console is empty: there is no source to apply.");
  return text;
}
