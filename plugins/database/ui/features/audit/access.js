// What agents may reach of each connection (PG-91, ADR 0346): whether it is closed to them, whether
// they may run EXPLAIN ANALYZE, and the columns the person marks sensitive, which are masked in
// everything an agent reads (mask.js). Kept in the plugin's store under one key of its own, by the
// connection's id (a database of its server is the same connection), never in the connection's
// fields: agents never change it, only the person does. No DOM.

import { baseOf } from "../../databases.js";
import { t } from "../../strings/index.js";

/**
 * @typedef {{ closed: boolean, analyze: boolean, sensitive: string[] }} Access
 * @typedef {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} Bridge
 */

export const ACCESS_KEY = "agent-access";
const SENSITIVE_MAX = 200;
/** A column, a table's column or a schema's table's column: one to three names, no space. */
const COLUMN = /^[^.\s]{1,63}(?:\.[^.\s]{1,63}){0,2}$/u;

/** @returns {Access} */
export const openAccess = () => ({ closed: false, analyze: false, sensitive: [] });

/** A sensitive column as the person types it, or the sentence why it is not one. */
export function columnOf(/** @type {unknown} */ text) {
  const name = typeof text === "string" ? text.trim().replaceAll('"', "") : "";
  if (!COLUMN.test(name)) return { error: t("features.audit.access.nameAColumnAsColumnTable") };
  return { name };
}

/** Only the known fields, each of its own type. @returns {Access} */
function clean(/** @type {unknown} */ value) {
  const v = /** @type {Partial<Access>} */ (value && typeof value === "object" ? value : {});
  const sensitive = Array.isArray(v.sensitive)
    ? [...new Set(v.sensitive.flatMap((s) => columnOf(s).name ?? []))].slice(0, SENSITIVE_MAX)
    : [];
  return { closed: v.closed === true, analyze: v.analyze === true, sensitive };
}

/** @param {Bridge} bridge */
export function createAccess(bridge) {
  /** @type {Promise<Record<string, Access>> | undefined} */
  let loaded;
  const all = () => {
    loaded ??= bridge
      .call("store.get", { key: ACCESS_KEY })
      .catch(() => ({}))
      .then((kept) => {
        const value = /** @type {{ value?: unknown }} */ (kept).value;
        /** @type {Record<string, Access>} */
        const out = {};
        if (value && typeof value === "object")
          for (const [id, access] of Object.entries(value)) out[id] = clean(access);
        return out;
      });
    return loaded;
  };

  return {
    /** A connection's access; open with nothing masked when the person set none. */
    of: async (/** @type {string} */ connection) =>
      (await all())[baseOf(connection)] ?? openAccess(),
    /** Whether any connection is closed to agents. */
    anyClosed: async () => Object.values(await all()).some((a) => a.closed),
    /** Change a connection's access (the person's act); answers the new one. */
    set: async (/** @type {string} */ connection, /** @type {Partial<Access>} */ patch) => {
      const map = await all();
      const id = baseOf(connection);
      const next = clean({ ...(map[id] ?? openAccess()), ...patch });
      map[id] = next;
      await bridge.call("store.set", { key: ACCESS_KEY, value: map });
      return next;
    },
  };
}
