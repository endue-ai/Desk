// A chart's settings kept with a starred query (PG-44, ADR 0336): in the plugin's store under
// `charts:<connection>`, one entry per starred query by its name and SQL, so the query's next run
// draws the same chart. Only a starred query keeps one; an entry whose query was unstarred or
// changed is dropped on the next write. No DOM.

import { readSaved } from "../history.js";

/**
 * @typedef {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} Bridge
 * @typedef {import("./aggregate.js").Settings} Settings
 * @typedef {{ name: string, sql: string, settings: Settings }} Kept
 */

const keyOf = (/** @type {string} */ connection) => `charts:${connection}`;
/** A statement as starred and as run compare: without its end's semicolon and whitespace. */
const plain = (/** @type {string} */ sql) => sql.trim().replace(/;\s*$/u, "").trim();

async function read(/** @type {Bridge} */ bridge, /** @type {string} */ connection) {
  const kept = await bridge.call("store.get", { key: keyOf(connection) }).catch(() => ({}));
  return Array.isArray(kept.value) ? /** @type {Kept[]} */ (kept.value) : [];
}

/** The starred query a statement is, if any. */
async function starOf(
  /** @type {Bridge} */ bridge,
  /** @type {string} */ connection,
  /** @type {string} */ sql,
) {
  const saved = await readSaved(bridge, connection);
  return { saved, star: saved.find((s) => plain(s.sql) === plain(sql)) };
}

/** The chart settings kept with the starred query a statement is. @returns {Promise<Settings | undefined>} */
export async function keptChart(
  /** @type {Bridge} */ bridge,
  /** @type {string} */ connection,
  /** @type {string} */ sql,
) {
  const { star } = await starOf(bridge, connection, sql);
  if (!star) return undefined;
  const list = await read(bridge, connection);
  return list.find((k) => k.name === star.name && plain(k.sql) === plain(star.sql))?.settings;
}

/** Keep settings with the starred query a statement is; the query's name, or undefined for none. */
export async function keepChart(
  /** @type {Bridge} */ bridge,
  /** @type {string} */ connection,
  /** @type {string} */ sql,
  /** @type {Settings} */ settings,
) {
  const { saved, star } = await starOf(bridge, connection, sql);
  if (!star) return undefined;
  const live = (/** @type {Kept} */ k) =>
    k.name !== star.name && saved.some((s) => s.name === k.name && plain(s.sql) === plain(k.sql));
  const list = [
    ...(await read(bridge, connection)).filter(live),
    { name: star.name, sql: star.sql, settings },
  ].sort((a, b) => a.name.localeCompare(b.name));
  await bridge.call("store.set", { key: keyOf(connection), value: list });
  return star.name;
}
