// The schema cache's commands (PG-06, ADR 0285): Database: read the schema again reads every chosen
// schema of a PostgreSQL connection now, and Database: choose the schemas to read toggles one schema
// in or out of what the cache reads (system schemas are out until chosen), or goes back to every
// schema but the system ones. The cache itself is schema-cache/; the explorer shows what it holds.

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/common.js").Connection} Connection
 */

const DEFAULT = "\u0000default";

/** A PostgreSQL connection named or picked; another engine says it is read as it opens. */
async function cachedConnection(/** @type {Deps} */ deps, /** @type {unknown} */ ref, title = "") {
  const conn = await deps.manager.choose(/** @type {string | undefined} */ (ref), title);
  if (!conn) return undefined;
  if (!deps.catalog.cache.cached(conn))
    throw new Error(`${conn.name} is not cached: its schema is read as the explorer opens it.`);
  return conn;
}

/** Read every chosen schema again, now. */
async function reload(/** @type {Deps} */ deps, /** @type {Record<string, unknown>} */ args) {
  const conn = await cachedConnection(
    deps,
    args.connection,
    "Database: read the schema of which connection?",
  );
  if (!conn) return undefined;
  const report = await deps.catalog.cache.refresh(conn, { all: true });
  const count = report.read.length;
  deps.say(
    `Read ${count} schema${count === 1 ? "" : "s"} of ${conn.name} in ${report.statements} statements.`,
  );
  return report;
}

/** Toggle one schema in or out of what is read, or go back to the default. */
async function choose(/** @type {Deps} */ deps, /** @type {Record<string, unknown>} */ args) {
  const conn = await cachedConnection(
    deps,
    args.connection,
    "Database: choose the schemas of which connection?",
  );
  if (!conn) return undefined;
  const { cache } = deps.catalog;
  await cache.open(conn);
  const all = cache.view(conn)?.all() ?? [];
  const picked =
    typeof args.schema === "string"
      ? args.schema
      : await deps.pick(`Database: read which schemas of ${conn.name}?`, [
          { id: DEFAULT, label: "Every schema but the system ones", detail: "the default" },
          ...all.map((s) => ({
            id: s.name,
            label: `${s.chosen ? "✓ " : ""}${s.name}`,
            detail: `${s.system ? "system · " : ""}${s.chosen ? "read: pick to leave it out" : "not read: pick to read it"}`,
          })),
        ]);
  if (picked === undefined) return undefined;
  if (picked === DEFAULT) {
    await cache.choose(conn, null);
    deps.say(`${conn.name}: every schema but the system ones is read.`);
    return null;
  }
  if (!all.some((s) => s.name === picked)) throw new Error(`${conn.name} has no schema ${picked}.`);
  const now = all.filter((s) => s.chosen).map((s) => s.name);
  const next = now.includes(picked) ? now.filter((s) => s !== picked) : [...now, picked];
  await cache.choose(conn, next);
  deps.say(now.includes(picked) ? `${picked} is no longer read.` : `${picked} is read.`);
  return next;
}

/** @type {import("../../feature-host.js").Feature} */
export const feature = {
  id: "schema-cache",
  commands: (deps) => ({
    "endue.database.reload-schema": (args) => reload(deps, args),
    "endue.database.choose-schemas": (args) => choose(deps, args),
  }),
};
