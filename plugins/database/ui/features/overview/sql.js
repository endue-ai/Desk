// What the overview's SQL shares (sections.js): the schemas a person's own objects live in, a
// quoted name, the version checks, and the shape every section has. Every statement here only
// reads catalogs, statistics views and size functions. No DOM.

/**
 * @typedef {"bytes" | "count" | "estimate" | "percent" | "seconds" | "ms" | "time" | "bool" | "text" | "query"} Format
 * @typedef {{ key: string, label: string, format?: Format }} Column
 * @typedef {{
 *   id: string, title: string, source: string, counters: "database" | "statements" | "rows" | "none",
 *   columns: Column[], empty: string, sql?: string, note?: string, missing?: string, search?: boolean,
 * }} Section
 *   `source` names the statistic the figures come from; `counters` says whose reset time they count
 *   since (the database's, pg_stat_statements', each row's own, or none: a size or a definition).
 *   A section with `missing` runs nothing and says why, and what the person can do.
 * @typedef {import("./probe.js").Server} Server
 */

/** The person's own schemas: not information_schema, pg_catalog, pg_toast or a temporary one. */
export const USER_SCHEMA = "n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'";

/** At most this many rows a section (fewer where said). */
export const LIMIT = 50;

/** Lines of SQL, the empty ones left out. */
export const lines = (/** @type {(string | false | null | undefined)[]} */ ...parts) =>
  parts.filter(Boolean).join("\n");

/** A quoted identifier. */
export const ident = (/** @type {string} */ name) => `"${name.replaceAll('"', '""')}"`;

/** The server is this major version or later (server_version_num, 170000 for 17). */
export const since = (/** @type {Server} */ server, /** @type {number} */ major) =>
  server.versionNum >= major * 10000;

/** A dotted version (an extension's 1.10) is at least `want`. */
export function atLeast(/** @type {string} */ version, /** @type {string} */ want) {
  const a = version.split(".").map(Number);
  const b = want.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}
