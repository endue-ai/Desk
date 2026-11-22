// What each privileges dialog asks (PG-54): the review of a matrix's changes (CASCADE, what a
// revoke takes along, grants it leaves to their grantors), a role's attributes and its password,
// a membership's options, a policy's form, a drop and a table's row security. The dialog writes the
// script from the same model (script.js), so a model is data only and never holds a password.
// Pure.

import { dependentGrants, othersGrants } from "./acl.js";
import { DEFAULT_KINDS } from "./kinds.js";
import { ATTRIBUTES } from "./roles.js";

/**
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {{ name: string, label: string, kind: "text" | "password" | "select" | "textarea", value: string, options?: string[], list?: string[], hint?: string }} Field
 * @typedef {{ name: string, label: string, hint: string, checked: boolean, disabled?: boolean }} Choice
 * @typedef {"grants" | "defaults" | "role" | "membership" | "policy" | "drop-policy" | "row-security"} Op
 * @typedef {{
 *   op: Op, title: string, where: string, tag: string, fields: Field[], choices: Choice[],
 *   notes: string[], run: string, danger: boolean, data: any,
 * }} ChangeModel
 */

export const DIALOG = "privileges-change";

const yes = (/** @type {unknown} */ v) => v === true || v === "true";
export const text = (/** @type {Record<string, unknown>} */ given, /** @type {string} */ key) =>
  typeof given[key] === "string" ? /** @type {string} */ (given[key]) : undefined;

/** Where it runs and the parts every model has. */
export const base = (
  /** @type {Connection} */ conn,
  /** @type {Op} */ op,
  /** @type {string} */ title,
) => ({
  op,
  title,
  where: `${conn.name} · PostgreSQL`,
  tag: conn.tag === "none" ? "" : conn.tag,
  fields: /** @type {Field[]} */ ([]),
  choices: /** @type {Choice[]} */ ([]),
  notes: /** @type {string[]} */ ([]),
  run: "Run",
  danger: false,
});

/**
 * The review of an object's matrix changes.
 * @param {Connection} conn
 * @param {{ said: string, on: string, changes: import("./acl.js").Change[], entries: import("./acl.js").Entry[], matrix: import("./acl.js").Matrix, as: string[] }} data
 * @param {Record<string, unknown>} given
 * @returns {ChangeModel}
 */
export function grantsModel(conn, data, given) {
  const model = { ...base(conn, "grants", `Change the privileges of ${data.said}`), data };
  const revokes = data.changes.some(
    (c) => c.to === "none" || (c.to === "granted" && c.from === "option"),
  );
  const along = dependentGrants(data.entries, data.changes);
  if (revokes)
    model.choices.push({
      name: "cascade",
      label: "CASCADE",
      hint: along.length
        ? `Also revokes what they granted with it: ${along.map((e) => `${e.privilege} to ${e.grantee}`).join(", ")}.`
        : "Nothing was granted on from these grants.",
      checked: yes(given.cascade),
    });
  if (along.length)
    model.notes.push("Without CASCADE the server refuses: they granted it on to others.");
  for (const left of othersGrants(data.matrix, data.changes, data.as))
    model.notes.push(
      `${left}: a REVOKE takes only what ${data.as[0]} granted, so that grant stays.`,
    );
  model.run = revokes ? "Grant and revoke" : "Grant";
  model.danger = revokes;
  return model;
}

/**
 * The review of default privileges' changes, one entry or more.
 * @param {Connection} conn
 * @param {{ groups: { entry: { owner: string, schema: string, letter: string }, changes: import("./acl.js").Change[] }[] }} data
 */
export function defaultsModel(conn, data) {
  const model = { ...base(conn, "defaults", "Change default privileges"), data };
  model.notes.push("They apply to objects made from now on; objects already there keep theirs.");
  return model;
}

/**
 * A new default privileges grant: owner, schema, kind, grantee and privileges, from a command or
 * the panel.
 * @param {Connection} conn
 * @param {{ roles: string[], schemas: string[], version: number }} data
 * @param {Record<string, unknown>} given
 */
export function newDefaultModel(conn, data, given) {
  const model = {
    ...base(conn, "defaults", "Change default privileges"),
    data: { ...data, form: true },
  };
  const on = text(given, "on") ?? "tables";
  model.fields.push(
    {
      name: "owner",
      label: "Objects made by",
      kind: "text",
      value: text(given, "owner") ?? "",
      list: data.roles,
    },
    {
      name: "schema",
      label: "In schema",
      kind: "text",
      value: text(given, "schema") ?? "",
      list: data.schemas,
      hint: "Empty: every schema.",
    },
    {
      name: "on",
      label: "On",
      kind: "select",
      value: on,
      options: Object.values(DEFAULT_KINDS).map((k) => k.on.toLowerCase()),
    },
    {
      name: "grantee",
      label: "Grantee",
      kind: "text",
      value: text(given, "grantee") ?? "",
      list: ["PUBLIC", ...data.roles],
    },
    {
      name: "grant",
      label: "Grant",
      kind: "text",
      value: listText(given.grant),
      hint: "Privileges, comma-separated: SELECT, INSERT.",
    },
    { name: "revoke", label: "Revoke", kind: "text", value: listText(given.revoke) },
  );
  model.choices.push({
    name: "option",
    label: "WITH GRANT OPTION",
    hint: "The grantee may grant them on.",
    checked: yes(given.grantOption),
  });
  model.notes.push("They apply to objects made from now on; objects already there keep theirs.");
  return model;
}

export const listText = (/** @type {unknown} */ v) =>
  Array.isArray(v)
    ? v.filter((x) => typeof x === "string").join(", ")
    : typeof v === "string"
      ? v
      : "";

/** The role names and words for each attribute's choice. */
const ATTRIBUTE_WORDS = {
  login: ["LOGIN", "It may log in."],
  superuser: ["SUPERUSER", "Every check passes: give it to as few roles as you can."],
  createDb: ["CREATEDB", "It may create databases."],
  createRole: ["CREATEROLE", "It may create, change and drop roles."],
  replication: ["REPLICATION", "It may connect for replication."],
  bypassRls: ["BYPASSRLS", "Row security policies do not apply to it."],
  inherit: ["INHERIT", "It has the privileges of the roles it joins."],
};

/**
 * A new role (`before` null) or a role's attributes and password.
 * @param {Connection} conn
 * @param {{ before: import("./model.js").Role | null, roles: string[] }} data
 * @param {Record<string, unknown>} given
 */
export function roleModel(conn, data, given) {
  const { before } = data;
  const model = {
    ...base(conn, "role", before ? `Change role ${before.name}` : "Create a role"),
    data,
  };
  if (!before)
    model.fields.push({
      name: "name",
      label: "Name",
      kind: "text",
      value: text(given, "name") ?? "",
      hint: "Written as typed, in quotes: its case is kept.",
    });
  for (const [choice, , field, fallback] of ATTRIBUTES) {
    const [label, hint] = ATTRIBUTE_WORDS[choice];
    const arg = given[field];
    model.choices.push({
      name: choice,
      label,
      hint,
      checked: typeof arg === "boolean" ? arg : before ? before[field] : fallback,
    });
  }
  const limit = given.connectionLimit;
  model.fields.push(
    {
      name: "limit",
      label: "Connection limit",
      kind: "text",
      value: typeof limit === "number" ? String(limit) : String(before?.limit ?? -1),
      hint: "-1: no limit.",
    },
    {
      name: "until",
      label: "Valid until",
      kind: "text",
      value: text(given, "validUntil") ?? before?.until ?? "",
      hint: "A time its password stops working, e.g. 2027-01-01; empty: never.",
    },
    {
      name: "password",
      label: "New password",
      kind: "password",
      value: "",
      hint: "Empty keeps it. It is sent only as its SCRAM-SHA-256 verifier.",
    },
  );
  if (!before)
    model.fields.push({
      name: "memberOf",
      label: "Member of",
      kind: "text",
      value: listText(given.memberOf),
      list: data.roles,
      hint: "Roles it joins, comma-separated.",
    });
  else
    model.choices.push({
      name: "clearPassword",
      label: "PASSWORD NULL",
      hint: "Removes its password: it can no longer log in with one.",
      checked: false,
    });
  model.notes.push(
    "A password is never read, kept, logged or written to the history: the script shows it masked.",
  );
  model.run = before ? "Change role" : "Create role";
  return model;
}

/**
 * A membership granted, revoked or changed.
 * @param {Connection} conn
 * @param {import("./roles.js").MembershipData & { roles: string[] }} data
 * @param {Record<string, unknown>} given
 */
export function membershipModel(conn, data, given) {
  const sixteen = data.version >= 160000;
  const now = data.now;
  const model = { ...base(conn, "membership", "Change a membership"), data };
  model.fields.push(
    {
      name: "role",
      label: "Role",
      kind: "text",
      value: data.role,
      list: data.roles,
      hint: "The role whose privileges the member gets.",
    },
    { name: "member", label: "Member", kind: "text", value: data.member, list: data.roles },
  );
  const pick = (/** @type {string} */ key, /** @type {boolean} */ fallback) =>
    typeof given[key] === "boolean" ? /** @type {boolean} */ (given[key]) : fallback;
  model.choices.push({
    name: "revoke",
    label: "REVOKE",
    hint: "Takes the membership away.",
    checked: yes(given.revoke),
    disabled: !now,
  });
  model.choices.push({
    name: "admin",
    label: "ADMIN",
    hint: "The member may grant this role to others.",
    checked: pick("admin", now?.admin ?? false),
  });
  if (sixteen) {
    model.choices.push({
      name: "inherit",
      label: "INHERIT",
      hint: "The member has its privileges without SET ROLE.",
      checked: pick("inherit", now?.inherit ?? data.inheritDefault),
    });
    model.choices.push({
      name: "set",
      label: "SET",
      hint: "The member may SET ROLE to it.",
      checked: pick("set", now?.set ?? true),
    });
  } else
    model.notes.push(
      "Before PostgreSQL 16 the member's INHERIT attribute decides what it inherits.",
    );
  if (now) model.notes.push(`${data.member} is a member of ${data.role} now.`);
  model.run = "Run";
  return model;
}
