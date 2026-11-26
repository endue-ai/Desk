// The row security dialogs' models (PG-54): a policy's form, a drop and a table's row security,
// in the shape of models.js's, so the same dialog draws them. Pure.

import { t } from "../../strings/index.js";
import { base, listText, text } from "./models.js";
import { COMMANDS } from "./policies.js";

/** @typedef {import("../../engines/common.js").Connection} Connection */

/**
 * A table's policy, new (`before` undefined) or changed.
 * @param {Connection} conn
 * @param {{ table: { schema: string, table: string }, before?: import("./model.js").Policy, on: boolean, roles: string[] }} data
 * @param {Record<string, unknown>} given
 */
export function policyModel(conn, data, given) {
  const p = data.before;
  const said = `${data.table.schema}.${data.table.table}`;
  const model = {
    ...base(
      conn,
      "policy",
      p ? `Change policy ${p.name} on ${said}` : `Create a policy on ${said}`,
    ),
    data,
  };
  const roles = Array.isArray(given.roles) ? listText(given.roles) : text(given, "roles");
  model.fields.push(
    {
      name: "name",
      label: t("features.privileges.policyModels.name"),
      kind: "text",
      value: text(given, "newName") ?? text(given, "name") ?? p?.name ?? "",
    },
    {
      name: "command",
      label: t("features.privileges.policyModels.for"),
      kind: "select",
      value: (text(given, "command") ?? p?.command ?? "ALL").toUpperCase(),
      options: COMMANDS,
    },
    {
      name: "roles",
      label: t("features.privileges.policyModels.to"),
      kind: "text",
      value: roles ?? p?.roles.join(", ") ?? "PUBLIC",
      list: ["PUBLIC", ...data.roles],
      hint: t("features.privileges.policyModels.rolesCommaSeparatedPublicForEvery"),
    },
    {
      name: "using",
      label: t("features.privileges.policyModels.using"),
      kind: "textarea",
      value: text(given, "using") ?? p?.using ?? "",
      hint: t("features.privileges.policyModels.whichRowsItMaySeeUpdate"),
    },
    {
      name: "check",
      label: t("features.privileges.policyModels.withCheck"),
      kind: "textarea",
      value: text(given, "check") ?? p?.check ?? "",
      hint: t("features.privileges.policyModels.whichRowsItMayWriteEmpty"),
    },
  );
  model.choices.push({
    name: "restrictive",
    label: t("features.privileges.policyModels.asRestrictive"),
    hint: t("features.privileges.policyModels.everyRestrictivePolicyMustPassToo"),
    checked: typeof given.restrictive === "boolean" ? given.restrictive : p ? !p.permissive : false,
  });
  if (!data.on) model.notes.push(t("features.privileges.policyModels.rowSecurityIsOffOnThis"));
  if (p) model.notes.push(t("features.privileges.policyModels.anotherCommandOrKindOrAn"));
  model.notes.push(t("features.privileges.policyModels.theTableSOwnerPassesIts"));
  model.run = p ? "Change policy" : "Create policy";
  return model;
}

/** Dropping a policy. */
export function dropPolicyModel(
  /** @type {Connection} */ conn,
  /** @type {{ table: { schema: string, table: string }, name: string }} */ data,
) {
  const model = {
    ...base(
      conn,
      "drop-policy",
      `Drop policy ${data.name} on ${data.table.schema}.${data.table.table}`,
    ),
    data,
  };
  model.notes.push(t("features.privileges.policyModels.theRowsItLetRolesReach"));
  model.run = "Drop";
  model.danger = true;
  return model;
}

/** A table's row security. */
export function rowSecurityModel(
  /** @type {Connection} */ conn,
  /** @type {{ table: { schema: string, table: string }, before: { on: boolean, forced: boolean } }} */ data,
  /** @type {Record<string, unknown>} */ given,
) {
  const model = {
    ...base(conn, "row-security", `Row security of ${data.table.schema}.${data.table.table}`),
    data,
  };
  model.choices.push(
    {
      name: "enable",
      label: t("features.privileges.policyModels.enable"),
      hint: t("features.privileges.policyModels.itsPoliciesDecideWhichRowsEach"),
      checked: typeof given.enable === "boolean" ? given.enable : data.before.on,
    },
    {
      name: "force",
      label: t("features.privileges.policyModels.force"),
      hint: t("features.privileges.policyModels.itsOwnerIsHeldToThe"),
      checked: typeof given.force === "boolean" ? given.force : data.before.forced,
    },
  );
  model.run = "Apply";
  return model;
}
