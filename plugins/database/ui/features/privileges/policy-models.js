// The row security dialogs' models (PG-54): a policy's form, a drop and a table's row security,
// in the shape of models.js's, so the same dialog draws them. Pure.

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
      label: "Name",
      kind: "text",
      value: text(given, "newName") ?? text(given, "name") ?? p?.name ?? "",
    },
    {
      name: "command",
      label: "For",
      kind: "select",
      value: (text(given, "command") ?? p?.command ?? "ALL").toUpperCase(),
      options: COMMANDS,
    },
    {
      name: "roles",
      label: "To",
      kind: "text",
      value: roles ?? p?.roles.join(", ") ?? "PUBLIC",
      list: ["PUBLIC", ...data.roles],
      hint: "Roles, comma-separated; PUBLIC for every role.",
    },
    {
      name: "using",
      label: "USING",
      kind: "textarea",
      value: text(given, "using") ?? p?.using ?? "",
      hint: "Which rows it may see, update or delete: an expression, e.g. owner = current_user.",
    },
    {
      name: "check",
      label: "WITH CHECK",
      kind: "textarea",
      value: text(given, "check") ?? p?.check ?? "",
      hint: "Which rows it may write. Empty on ALL and UPDATE: USING checks them too.",
    },
  );
  model.choices.push({
    name: "restrictive",
    label: "AS RESTRICTIVE",
    hint: "Every restrictive policy must pass too; permissive ones are joined with OR.",
    checked: typeof given.restrictive === "boolean" ? given.restrictive : p ? !p.permissive : false,
  });
  if (!data.on)
    model.notes.push(
      "Row security is off on this table: its policies do nothing until it is turned on.",
    );
  if (p)
    model.notes.push(
      "Another command or kind, or an expression taken away, drops and creates the policy in one transaction.",
    );
  model.notes.push(
    "The table's owner passes its policies unless row security is forced; superusers and BYPASSRLS roles always do.",
  );
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
  model.notes.push(
    "The rows it let roles reach are hidden from them again, unless another policy lets them.",
  );
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
      label: "ENABLE",
      hint: "Its policies decide which rows each role reaches; with none, no rows.",
      checked: typeof given.enable === "boolean" ? given.enable : data.before.on,
    },
    {
      name: "force",
      label: "FORCE",
      hint: "Its owner is held to the policies too.",
      checked: typeof given.force === "boolean" ? given.force : data.before.forced,
    },
  );
  model.run = "Apply";
  return model;
}
