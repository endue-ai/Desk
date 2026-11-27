// The schema cache over the scripted server and a store in memory, for its tests: every statement it
// runs is recorded (`sqls`), every step of a pass it reports (`steps`), and a test may hold the
// server back (`gate`) or act after a statement (`after`).
import type { Connection } from "../ui/engines/common.js";
import { createSchemaCache } from "../ui/schema-cache/index.js";
import { catalogScript, type PgCatalog } from "./pg-catalog";
import { scriptedExecutor } from "./scripted";

/** The PostgreSQL connection of the tests. */
export const PG: Connection = {
  id: "c-prod",
  name: "Shop",
  engine: "postgresql",
  host: "db.example",
  port: 5432,
  database: "shop",
  user: "app",
  ssl: "require",
  sslCa: "",
  file: "",
  tag: "none",
  readOnly: false,
};

/** store.get and store.set over a map, values copied as the bridge copies them. */
export function memoryStore(values = new Map<string, unknown>()) {
  const sets: string[] = [];
  return {
    values,
    sets,
    get: async (key: string) => structuredClone(values.get(key)),
    set: async (key: string, value: unknown) => {
      sets.push(key);
      values.set(key, structuredClone(value));
    },
  };
}

export function cacheOver(
  model: () => PgCatalog,
  options: {
    store?: ReturnType<typeof memoryStore>;
    system?: boolean;
    gate?: Promise<void>;
    after?(sql: string, count: number): void;
    conn?: Connection;
  } = {},
) {
  const sqls: string[] = [];
  const steps: string[] = [];
  const store = options.store ?? memoryStore();
  const conn = options.conn ?? PG;
  const { execute } = scriptedExecutor(catalogScript(model));
  const cache = createSchemaCache({
    execute: async (c, sql, opts) => {
      sqls.push(sql);
      await options.gate;
      const done = await execute(c, sql, opts);
      options.after?.(sql, sqls.length);
      return done;
    },
    store,
    systemSchemas: () => options.system ?? false,
    changed: () => {
      const status = cache.view(conn)?.status;
      if (status?.state === "reading")
        steps.push(`${status.step} of ${status.steps} ${status.label}`);
    },
  });
  return { cache, sqls, steps, store };
}
