import { t } from "../../strings/index.js";

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
    throw new Error(
      t("features.schemaCache.index.isNotCachedItsSchemaIs", { name: String(conn.name) }),
    );
  return conn;
}

/** Read every chosen schema again, now. */
async function reload(/** @type {Deps} */ deps, /** @type {Record<string, unknown>} */ args) {
  const conn = await cachedConnection(
    deps,
    args.connection,
    t("features.schemaCache.index.databaseReadTheSchemaOfWhich"),
  );
  if (!conn) return undefined;
  const report = await deps.catalog.cache.refresh(conn, { all: true });
  const count = report.read.length;
  deps.say(
    t("features.schemaCache.index.readSchemaOfInStatements", {
      count: String(count),
      value: String(count === 1 ? "" : t("features.schemaCache.index.s")),
      name: String(conn.name),
      statements: String(report.statements),
    }),
  );
  return report;
}

/** Toggle one schema in or out of what is read, or go back to the default. */
async function choose(/** @type {Deps} */ deps, /** @type {Record<string, unknown>} */ args) {
  const conn = await cachedConnection(
    deps,
    args.connection,
    t("features.schemaCache.index.databaseChooseTheSchemasOfWhich"),
  );
  if (!conn) return undefined;
  const { cache } = deps.catalog;
  await cache.open(conn);
  const all = cache.view(conn)?.all() ?? [];
  const picked =
    typeof args.schema === "string"
      ? args.schema
      : await deps.pick(
          t("features.schemaCache.index.databaseReadWhichSchemasOf", { name: String(conn.name) }),
          [
            {
              id: DEFAULT,
              label: t("features.schemaCache.index.everySchemaButTheSystemOnes"),
              detail: t("features.schemaCache.index.theDefault"),
            },
            ...all.map((s) => ({
              id: s.name,
              label: `${s.chosen ? "✓ " : ""}${s.name}`,
              detail: `${s.system ? "system · " : ""}${s.chosen ? "read: pick to leave it out" : "not read: pick to read it"}`,
            })),
          ],
        );
  if (picked === undefined) return undefined;
  if (picked === DEFAULT) {
    await cache.choose(conn, null);
    deps.say(
      t("features.schemaCache.index.everySchemaButTheSystemOnes2", { name: String(conn.name) }),
    );
    return null;
  }
  if (!all.some((s) => s.name === picked))
    throw new Error(
      t("features.schemaCache.index.hasNoSchema", {
        name: String(conn.name),
        picked: String(picked),
      }),
    );
  const now = all.filter((s) => s.chosen).map((s) => s.name);
  const next = now.includes(picked) ? now.filter((s) => s !== picked) : [...now, picked];
  await cache.choose(conn, next);
  deps.say(
    now.includes(picked)
      ? t("features.schemaCache.index.isNoLongerRead", { picked: String(picked) })
      : t("features.schemaCache.index.isRead", { picked: String(picked) }),
  );
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
