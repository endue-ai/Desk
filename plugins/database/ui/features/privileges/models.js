// What each privileges dialog asks (PG-54): the review of a matrix's changes (CASCADE, what a
// revoke takes along, grants it leaves to their grantors), a role's attributes and its password,
// a membership's options, a policy's form, a drop and a table's row security. The dialog writes the
// script from the same model (script.js), so a model is data only and never holds a password.
// Pure.

import { t } from "../../strings/index.js";
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
      label: t("features.privileges.models.cascade"),
      hint: along.length
        ? t("features.privileges.models.alsoRevokesWhatTheyGrantedWith", {
            value: String(along.map((e) => `${e.privilege} to ${e.grantee}`).join(", ")),
          })
        : t("features.privileges.models.nothingWasGrantedOnFromThese"),
      checked: yes(given.cascade),
    });
  if (along.length)
    model.notes.push(t("features.privileges.models.withoutCascadeTheServerRefusesThey"));
  for (const left of othersGrants(data.matrix, data.changes, data.as))
    model.notes.push(
      t("features.privileges.models.aRevokeTakesOnlyWhatGranted", {
        left: String(left),
        value: String(data.as[0]),
      }),
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
  model.notes.push(t("features.privileges.models.theyApplyToObjectsMadeFrom"));
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
      label: t("features.privileges.models.objectsMadeBy"),
      kind: "text",
      value: text(given, "owner") ?? "",
      list: data.roles,
    },
    {
      name: "schema",
      label: t("features.privileges.models.inSchema"),
      kind: "text",
      value: text(given, "schema") ?? "",
      list: data.schemas,
      hint: t("features.privileges.models.emptyEverySchema"),
    },
    {
      name: "on",
      label: t("features.privileges.models.on"),
      kind: "select",
      value: on,
      options: Object.values(DEFAULT_KINDS).map((k) => k.on.toLowerCase()),
    },
    {
      name: "grantee",
      label: t("features.privileges.models.grantee"),
      kind: "text",
      value: text(given, "grantee") ?? "",
      list: ["PUBLIC", ...data.roles],
    },
    {
      name: "grant",
      label: t("features.privileges.models.grant"),
      kind: "text",
      value: listText(given.grant),
      hint: t("features.privileges.models.privilegesCommaSeparatedSelectInsert"),
    },
    {
      name: "revoke",
      label: t("features.privileges.models.revoke"),
      kind: "text",
      value: listText(given.revoke),
    },
  );
  model.choices.push({
    name: "option",
    label: t("features.privileges.models.withGrantOption"),
    hint: t("features.privileges.models.theGranteeMayGrantThemOn"),
    checked: yes(given.grantOption),
  });
  model.notes.push(t("features.privileges.models.theyApplyToObjectsMadeFrom"));
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
  login: ["LOGIN", t("features.privileges.models.itMayLogIn")],
  superuser: ["SUPERUSER", t("features.privileges.models.everyCheckPassesGiveItTo")],
  createDb: ["CREATEDB", t("features.privileges.models.itMayCreateDatabases")],
  createRole: ["CREATEROLE", t("features.privileges.models.itMayCreateChangeAndDrop")],
  replication: ["REPLICATION", t("features.privileges.models.itMayConnectForReplication")],
  bypassRls: ["BYPASSRLS", t("features.privileges.models.rowSecurityPoliciesDoNotApply")],
  inherit: ["INHERIT", t("features.privileges.models.itHasThePrivilegesOfThe")],
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
      label: t("features.privileges.models.name"),
      kind: "text",
      value: text(given, "name") ?? "",
      hint: t("features.privileges.models.writtenAsTypedInQuotesIts"),
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
      label: t("features.privileges.models.connectionLimit"),
      kind: "text",
      value: typeof limit === "number" ? String(limit) : String(before?.limit ?? -1),
      hint: t("features.privileges.models.noLimit"),
    },
    {
      name: "until",
      label: t("features.privileges.models.validUntil"),
      kind: "text",
      value: text(given, "validUntil") ?? before?.until ?? "",
      hint: t("features.privileges.models.aTimeItsPasswordStopsWorking"),
    },
    {
      name: "password",
      label: t("features.privileges.models.newPassword"),
      kind: "password",
      value: "",
      hint: t("features.privileges.models.emptyKeepsItItIsSent"),
    },
  );
  if (!before)
    model.fields.push({
      name: "memberOf",
      label: t("features.privileges.models.memberOf"),
      kind: "text",
      value: listText(given.memberOf),
      list: data.roles,
      hint: t("features.privileges.models.rolesItJoinsCommaSeparated"),
    });
  else
    model.choices.push({
      name: "clearPassword",
      label: t("features.privileges.models.passwordNull"),
      hint: t("features.privileges.models.removesItsPasswordItCanNo"),
      checked: false,
    });
  model.notes.push(t("features.privileges.models.aPasswordIsNeverReadKept"));
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
      label: t("features.privileges.models.role"),
      kind: "text",
      value: data.role,
      list: data.roles,
      hint: t("features.privileges.models.theRoleWhosePrivilegesTheMember"),
    },
    {
      name: "member",
      label: t("features.privileges.models.member"),
      kind: "text",
      value: data.member,
      list: data.roles,
    },
  );
  const pick = (/** @type {string} */ key, /** @type {boolean} */ fallback) =>
    typeof given[key] === "boolean" ? /** @type {boolean} */ (given[key]) : fallback;
  model.choices.push({
    name: "revoke",
    label: t("features.privileges.models.revoke2"),
    hint: t("features.privileges.models.takesTheMembershipAway"),
    checked: yes(given.revoke),
    disabled: !now,
  });
  model.choices.push({
    name: "admin",
    label: t("features.privileges.models.admin"),
    hint: t("features.privileges.models.theMemberMayGrantThisRole"),
    checked: pick(t("features.privileges.models.admin2"), now?.admin ?? false),
  });
  if (sixteen) {
    model.choices.push({
      name: "inherit",
      label: t("features.privileges.models.inherit"),
      hint: t("features.privileges.models.theMemberHasItsPrivilegesWithout"),
      checked: pick(t("features.privileges.models.inherit2"), now?.inherit ?? data.inheritDefault),
    });
    model.choices.push({
      name: "set",
      label: t("features.privileges.models.set"),
      hint: t("features.privileges.models.theMemberMaySetRoleTo"),
      checked: pick(t("features.privileges.models.set2"), now?.set ?? true),
    });
  } else model.notes.push(t("features.privileges.models.beforePostgresqlTheMemberSInherit"));
  if (now)
    model.notes.push(
      t("features.privileges.models.isAMemberOfNow", {
        member: String(data.member),
        role: String(data.role),
      }),
    );
  model.run = "Run";
  return model;
}
