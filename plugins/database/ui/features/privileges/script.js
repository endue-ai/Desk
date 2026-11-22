// The script of a privileges dialog (PG-54): the one function the dialog calls as the person types
// (a password masked) and the controller calls before the run (with its verifier), so what is shown
// is what runs but for the mask. An Error says what is wrong with the answers. Pure.

import { defaultScript, grantScript } from "./grants.js";
import { DEFAULT_KINDS, defaultPrivilegesOf } from "./kinds.js";
import { dropPolicy, policyScript, rowSecurityScript } from "./policies.js";
import { listOf, membershipScript, roleScript } from "./roles.js";

/**
 * @typedef {import("./models.js").ChangeModel} ChangeModel
 * @typedef {{ values: Record<string, string>, choices: string[] }} Answers
 */

/** A new default privileges grant's changes, from its form. */
function formDefaults(/** @type {ChangeModel} */ model, /** @type {Answers} */ a) {
  const on = (a.values.on ?? "tables").toUpperCase();
  const letter = Object.entries(DEFAULT_KINDS).find(([, k]) => k.on === on)?.[0];
  if (!letter)
    throw new Error(
      `Default privileges are on ${Object.values(DEFAULT_KINDS)
        .map((k) => k.on.toLowerCase())
        .join(", ")}.`,
    );
  const grantee = (a.values.grantee ?? "").trim();
  if (!grantee) throw new Error("Name the grantee: a role or PUBLIC.");
  const offered = defaultPrivilegesOf(letter, model.data.version ?? 170000);
  const pick = (/** @type {string} */ field) =>
    listOf(a.values[field]).map((p) => {
      const word = p.toUpperCase() === "ALL" ? "ALL" : p.toUpperCase();
      if (word !== "ALL" && !offered.includes(word))
        throw new Error(`${p} is not a privilege on ${on.toLowerCase()}: ${offered.join(", ")}.`);
      return word;
    });
  const expand = (/** @type {string[]} */ list) => (list.includes("ALL") ? offered : list);
  const grant = expand(pick("grant"));
  const revoke = expand(pick("revoke"));
  const to = a.choices.includes("option") ? "option" : "granted";
  const changes = [
    ...revoke.map((privilege) => ({
      grantee: grantee.toUpperCase() === "PUBLIC" ? "PUBLIC" : grantee,
      column: "",
      privilege,
      from: /** @type {const} */ ("granted"),
      to: /** @type {const} */ ("none"),
    })),
    ...grant.map((privilege) => ({
      grantee: grantee.toUpperCase() === "PUBLIC" ? "PUBLIC" : grantee,
      column: "",
      privilege,
      from: /** @type {const} */ ("none"),
      to,
    })),
  ];
  return defaultScript(
    { owner: (a.values.owner ?? "").trim(), schema: (a.values.schema ?? "").trim(), letter },
    changes,
  );
}

/**
 * @param {ChangeModel} model
 * @param {Partial<Answers>} [given]
 * @param {import("./roles.js").Secret} [secret]
 */
export function scriptOf(model, given = {}, secret = {}) {
  const a = { values: given.values ?? {}, choices: given.choices ?? [] };
  const d = model.data;
  switch (model.op) {
    case "grants":
      return grantScript(d.on, d.changes, { cascade: a.choices.includes("cascade") });
    case "defaults":
      if (d.form) return formDefaults(model, a);
      return d.groups.map((/** @type {any} */ g) => defaultScript(g.entry, g.changes)).join("\n");
    case "role":
      return roleScript(d.before, a, secret);
    case "membership":
      return membershipScript(d, a);
    case "policy":
      return policyScript(d.table, d.before, a);
    case "drop-policy":
      return dropPolicy(d.table, d.name);
    case "row-security":
      return rowSecurityScript(d.table, d.before, a);
    default:
      throw new Error(`${model.op} writes no statement.`);
  }
}

/** The answers a dialog gave: its fields' values and the choices turned on. */
export function answersOf(/** @type {unknown} */ given) {
  const answers = /** @type {{ values?: unknown, choices?: unknown }} */ (given ?? {});
  /** @type {Record<string, string>} */
  const values = {};
  if (answers.values && typeof answers.values === "object")
    for (const [key, value] of Object.entries(answers.values))
      if (typeof value === "string") values[key] = value;
  const choices = Array.isArray(answers.choices)
    ? answers.choices.filter((c) => typeof c === "string")
    : [];
  return { values, choices: /** @type {string[]} */ (choices) };
}
