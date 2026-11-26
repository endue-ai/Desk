// Row security from the policy form (PG-54): CREATE POLICY with its kind, command, roles, USING and
// WITH CHECK; ALTER POLICY for a new name, roles or expressions; DROP and CREATE in one transaction
// where ALTER cannot (another command or kind, an expression taken away); DROP POLICY; and a table's
// row security turned on, off or forced. Each expression is the person's SQL, one expression in
// parentheses; what PostgreSQL refuses for a command is refused here first. Pure.

import { qualified } from "../../sql/quote.js";
import { split } from "../../sql/split.js";
import { t as messageText } from "../../strings/index.js";
import { granteeOf, q } from "./grants.js";
import { listOf } from "./roles.js";

/**
 * @typedef {import("./model.js").Policy} Policy
 * @typedef {{ schema: string, table: string }} Table
 * @typedef {{ values: Record<string, string>, choices: string[] }} Answers
 */

export const COMMANDS = ["ALL", "SELECT", "INSERT", "UPDATE", "DELETE"];
const tableOf = (/** @type {Table} */ t) => qualified("postgresql", t.schema, t.table);

/** One expression as typed, or "" for none; refused when it holds more than one statement. */
function expression(/** @type {string | undefined} */ text, /** @type {string} */ what) {
  const value = (text ?? "").trim();
  if (value === "") return "";
  if (split(value, "postgresql").length > 1)
    throw new Error(
      messageText("features.privileges.policies.isOneExpressionTakeTheOut", { what: String(what) }),
    );
  return value;
}

/** The form as a policy, checked as PostgreSQL checks it. @returns {Policy} */
export function policyOf(/** @type {Answers} */ a) {
  const name = (a.values.name ?? "").trim();
  if (!name) throw new Error(messageText("features.privileges.policies.typeThePolicySName"));
  const bytes = new TextEncoder().encode(name).length;
  if (bytes > 63)
    throw new Error(
      messageText("features.privileges.policies.postgresqlKeepsANameOfBytes", {
        bytes: String(bytes),
      }),
    );
  const command = (a.values.command ?? "ALL").toUpperCase();
  if (!COMMANDS.includes(command))
    throw new Error(
      messageText("features.privileges.policies.aPolicyIsFor", {
        value: String(COMMANDS.join(", ")),
      }),
    );
  const using = expression(a.values.using, "USING");
  const check = expression(a.values.check, "WITH CHECK");
  if (command === "INSERT" && using)
    throw new Error(messageText("features.privileges.policies.anInsertPolicyTakesOnlyWith"));
  if ((command === "SELECT" || command === "DELETE") && check)
    throw new Error(
      messageText("features.privileges.policies.aPolicyTakesOnlyUsingIt", {
        command: String(command),
      }),
    );
  const roles = listOf(a.values.roles);
  return {
    name,
    command,
    permissive: !a.choices.includes("restrictive"),
    roles: roles.length ? roles : ["PUBLIC"],
    using,
    check,
  };
}

const rolesSql = (/** @type {string[]} */ roles) =>
  roles.map((r) => (r.toUpperCase() === "PUBLIC" ? "PUBLIC" : granteeOf(r))).join(", ");

/** CREATE POLICY of a policy. */
export function createPolicy(/** @type {Table} */ table, /** @type {Policy} */ p) {
  return (
    `CREATE POLICY ${q(p.name)} ON ${tableOf(table)} AS ${p.permissive ? "PERMISSIVE" : "RESTRICTIVE"} ` +
    `FOR ${p.command} TO ${rolesSql(p.roles)}${p.using ? ` USING (${p.using})` : ""}` +
    `${p.check ? ` WITH CHECK (${p.check})` : ""};`
  );
}

const same = (/** @type {string[]} */ a, /** @type {string[]} */ b) =>
  a.length === b.length && [...a].sort().join("\u0000") === [...b].sort().join("\u0000");

/**
 * The form's script: CREATE for a new policy (`before` undefined), else ALTER, or DROP and CREATE
 * where ALTER cannot say the change.
 * @param {Table} table
 * @param {Policy | undefined} before
 * @param {Answers} answers
 */
export function policyScript(table, before, answers) {
  const p = policyOf(answers);
  if (!before) return createPolicy(table, p);
  const on = tableOf(table);
  const lost = (before.using && !p.using) || (before.check && !p.check);
  if (p.command !== before.command || p.permissive !== before.permissive || lost)
    return `DROP POLICY ${q(before.name)} ON ${on};\n${createPolicy(table, p)}`;
  /** @type {string[]} */
  const statements = [];
  if (p.name !== before.name)
    statements.push(`ALTER POLICY ${q(before.name)} ON ${on} RENAME TO ${q(p.name)};`);
  const parts = [
    ...(same(p.roles, before.roles) ? [] : [`TO ${rolesSql(p.roles)}`]),
    ...(p.using !== before.using ? [`USING (${p.using})`] : []),
    ...(p.check !== before.check ? [`WITH CHECK (${p.check})`] : []),
  ];
  if (parts.length) statements.push(`ALTER POLICY ${q(p.name)} ON ${on} ${parts.join(" ")};`);
  if (statements.length === 0)
    throw new Error(
      messageText("features.privileges.policies.nothingChangedIsAsItWas", {
        name: String(before.name),
      }),
    );
  return statements.join("\n");
}

/** DROP POLICY. */
export const dropPolicy = (/** @type {Table} */ table, /** @type {string} */ name) =>
  `DROP POLICY ${q(name)} ON ${tableOf(table)};`;

/**
 * Row security turned on or off and forced or not, only what changed.
 * @param {Table} table
 * @param {{ on: boolean, forced: boolean }} before
 * @param {Answers} answers `enable` and `force` among the choices.
 */
export function rowSecurityScript(table, before, answers) {
  const enable = answers.choices.includes("enable");
  const force = answers.choices.includes("force");
  const on = tableOf(table);
  /** @type {string[]} */
  const statements = [];
  if (enable !== before.on)
    statements.push(`ALTER TABLE ${on} ${enable ? "ENABLE" : "DISABLE"} ROW LEVEL SECURITY;`);
  if (force !== before.forced)
    statements.push(`ALTER TABLE ${on} ${force ? "FORCE" : "NO FORCE"} ROW LEVEL SECURITY;`);
  if (statements.length === 0)
    throw new Error(messageText("features.privileges.policies.nothingChangedRowSecurityIsAs"));
  return statements.join("\n");
}
