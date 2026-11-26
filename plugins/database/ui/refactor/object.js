// An object's rename made from the server's answers (PG-33): what is renamed (read-sql.js's facts
// with the aim and the new name), then every routine body that names it rewritten (bodies.js),
// listed with what follows the rename by itself (the dependency catalog's usages) and what to check
// by hand, for script.js to write. Pure.

import { catalogUsages } from "../navigate/usages.js";
import { t } from "../strings/index.js";
import { mentions, rewriteBody } from "./bodies.js";
import { BODIES_MAX } from "./read-sql.js";

/**
 * @typedef {import("../navigate/target.js").Aim} Aim
 * @typedef {import("./bodies.js").Rename} Rename
 * @typedef {import("./script.js").Parts} Parts
 * @typedef {(string | null)[]} Row
 * @typedef {{ detail: string, elsewhere: boolean, holders: string[], overloads: [string, string][] }} Facts
 */

const text = (/** @type {unknown} */ v) => (v === null || v === undefined ? "" : String(v));
const json = (/** @type {unknown} */ v) => {
  try {
    const parsed = JSON.parse(text(v) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/** The cache's word for a relkind. */
const RELKINDS = /** @type {Record<string, string>} */ ({
  r: "table",
  p: "partitioned table",
  v: "view",
  m: "materialized view",
  S: "sequence",
  f: "foreign table",
});

/** The facts row, or null when the server holds no such object. @returns {Facts | null} */
export function factsOf(/** @type {Row[]} */ rows) {
  const [row] = rows;
  if (!row) return null;
  const [detail, elsewhere, holders, overloads] = row;
  return {
    detail: text(detail),
    elsewhere: Number(text(elsewhere) || 0) > 0,
    holders: text(holders).split(",").filter(Boolean),
    overloads: /** @type {[string, string][]} */ (json(overloads)),
  };
}

/**
 * What is renamed.
 * @param {Aim} aim
 * @param {Facts} facts
 * @param {string} to
 * @param {number} [overload] the index of a function's overload
 * @returns {Rename}
 */
export function renameOf(aim, facts, to, overload = 0) {
  if (aim.kind === "relation")
    return {
      kind: "relation",
      relkind: RELKINDS[facts.detail] ?? "table",
      schema: aim.schema,
      name: aim.name,
      to,
    };
  if (aim.kind === "column")
    return {
      kind: "column",
      relkind: RELKINDS[facts.detail] ?? "table",
      schema: aim.schema,
      table: aim.table,
      name: aim.name,
      to,
    };
  if (aim.kind === "function") {
    const [args = "", kind = "f"] = facts.overloads[overload] ?? [];
    return {
      kind: "function",
      routine: kind === "p" ? "procedure" : "function",
      schema: aim.schema,
      name: aim.name,
      args,
      overloads: facts.overloads.length,
      to,
    };
  }
  if (aim.kind === "type")
    return { kind: "type", domain: facts.detail === "d", schema: aim.schema, name: aim.name, to };
  return { kind: "schema", name: aim.name, to };
}

/**
 * The parts of the script: the bodies rewritten (rows of read-sql.js's bodies statement), the
 * dependency catalog's rows, what to check.
 * @param {Rename} r
 * @param {Facts} facts
 * @param {Row[]} bodies
 * @param {Row[]} catalog
 * @returns {Parts}
 */
export function partsOf(r, facts, bodies, catalog) {
  /** @type {Parts} */
  const parts = {
    replaced: [],
    kept: catalogUsages(catalog),
    checks: [],
    capped: bodies.length > BODIES_MAX,
  };
  for (const row of bodies.slice(0, BODIES_MAX)) {
    const [schema, name, args, kind, language, source, definition, argnames, triggers, config] =
      row.map(text);
    const label = `${kind} ${schema}.${name}(${args})`;
    const done = rewriteBody(/** @type {string} */ (source), r, {
      language: /** @type {string} */ (language),
      args: json(argnames).map(text),
      triggers: json(triggers).map(text),
      holders: facts.holders,
      elsewhere: facts.elsewhere,
    });
    for (const h of done.hand) parts.checks.push({ label, line: h.line, why: h.why });
    if (r.kind === "schema" && config && mentions(config, r.name))
      parts.checks.push({ label, why: `its settings name the schema (${config})` });
    if (done.places === 0) continue;
    const def = /** @type {string} */ (definition);
    const at = def.lastIndexOf(/** @type {string} */ (source));
    if (at < 0) {
      parts.checks.push({ label, why: "its definition could not be read back" });
      continue;
    }
    parts.replaced.push({
      label: t("refactor.object.place", {
        label: String(label),
        places: String(done.places),
        value: String(done.places === 1 ? "" : t("refactor.object.s")),
      }),
      definition: def.slice(0, at) + done.text + def.slice(at + (source ?? "").length),
    });
  }
  return parts;
}
