// Fixtures for the SQL problems (PG-30, ADR 0294): the worker's checker over the vendored parser in
// Node, a schema model as the cache answers it (a partitioned table with its partition, a sequence
// without columns, an unread schema), and the problems of a script as [underlined text, message]
// pairs to read. The warnings (PG-36) are off here unless a test asks for them.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createChecker } from "../ui/diagnose/check.js";
import { indexModel, type SchemaModel } from "../ui/sql/parse/model.js";
import { loadLibpgQuery } from "../ui/sql/parse/wasm.js";

const columns = (...names: string[]) => names.map((name) => ({ name, type: "integer" }));

/**
 * public (people, orders, a view, a sequence), app (its own people), metrics (a partitioned table
 * and its partition, which the cache reads under it: PG-50) and later (not read).
 */
export const PROBLEM_MODEL: SchemaModel = {
  schemas: [
    {
      name: "public",
      relations: [
        { name: "people", kind: "table", columns: columns("id", "name", "email") },
        { name: "orders", kind: "table", columns: columns("id", "person", "total") },
        { name: "big_orders", kind: "view", columns: columns("id", "total") },
        { name: "people_id_seq", kind: "sequence" },
      ],
      routines: [{ name: "touch", kind: "function", args: "" }],
    },
    {
      name: "app",
      relations: [{ name: "people", kind: "table", columns: columns("id", "email") }],
      routines: [],
    },
    {
      name: "metrics",
      relations: [
        { name: "events", kind: "table", columns: columns("id", "at") },
        { name: "ev_2024", kind: "table", columns: columns("id", "at") },
      ],
      routines: [],
    },
    { name: "later" },
  ],
};

/** The same with pg_catalog's functions read, so an unqualified function can be told missing. */
export const WITH_CATALOG: SchemaModel = {
  schemas: [
    ...PROBLEM_MODEL.schemas,
    {
      name: "pg_catalog",
      relations: [{ name: "pg_class", kind: "table", columns: columns("oid", "relname") }],
      routines: [
        { name: "now", kind: "function", args: "" },
        { name: "count", kind: "function", args: '"any"' },
      ],
    },
  ],
};

export type Problem = { from: number; to: number; kind: string; message: string };
export type Check = {
  sql: string;
  doc?: string;
  syntax?: boolean;
  names?: boolean;
  warnings?: boolean;
  off?: string[];
  searchPath?: string[];
  user?: string;
  answers?: Array<[string, { ok: true } | { message: string; at: number }]>;
};

type Raw = Awaited<ReturnType<typeof loadLibpgQuery>>;
let raw: Promise<Raw> | undefined;

/** The vendored parser, loaded once per test file (a jsdom file too: its URL is not Node's). */
export const loadRaw = () => {
  raw ??= loadLibpgQuery(readFileSync(join(import.meta.dirname, "../ui/vendor/libpg-query.wasm")));
  return raw;
};

/** A checker over the parser, with every statement text it parses recorded in `parsed`. */
export async function checker() {
  const real = await loadRaw();
  const parsed: string[] = [];
  const spy = {
    ...real,
    parse: (sql: string) => {
      parsed.push(sql);
      return real.parse(sql);
    },
    broken: () => real.broken(),
  };
  const made = createChecker(spy);
  const indexes = new Map<SchemaModel, ReturnType<typeof indexModel>>();
  const index = (model: SchemaModel) => {
    const found = indexes.get(model) ?? indexModel(model);
    indexes.set(model, found);
    return found;
  };
  return {
    parsed,
    check: (request: Check, model: SchemaModel | null = PROBLEM_MODEL) =>
      made.check(
        { doc: "d", syntax: true, names: true, warnings: false, ...request },
        model ? index(model) : undefined,
      ) as { problems: Problem[]; statements: number; parsed: number },
  };
}

/** The problems of `sql` as the text each underlines and its message. */
export async function problemsOf(sql: string, more: Partial<Check> = {}, model?: SchemaModel) {
  const c = await checker();
  return c
    .check({ sql, ...more }, model ?? PROBLEM_MODEL)
    .problems.map((p) => [sql.slice(p.from, p.to), p.message]);
}
