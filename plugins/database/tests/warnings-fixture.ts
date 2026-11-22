// Fixtures for the SQL warnings (PG-36, ADR 0328): a schema model as the cache answers it, with
// column types, NOT NULL and index definitions (pg_get_indexdef's words), and the warnings of a
// script as [underlined text, identifier] pairs, or with their fixes applied.
import type { SchemaModel } from "../ui/sql/parse/model.js";
import { type Check, checker } from "./problems-fixture";

/**
 * public: people (a primary key, an index on email and joined, an expression index on lower(name)),
 * orders (a nullable person, numeric and float columns), tags (no column in common with people), a
 * view, and odd (columns that need quotes).
 */
export const WARN_MODEL: SchemaModel = {
  schemas: [
    {
      name: "public",
      relations: [
        {
          name: "people",
          kind: "table",
          columns: [
            { name: "id", type: "integer", notNull: true },
            { name: "name", type: "text" },
            { name: "email", type: "character varying(200)" },
            { name: "code", type: "character(3)" },
            { name: "manager", type: "integer" },
            { name: "joined", type: "date" },
          ],
          indexes: [
            "CREATE UNIQUE INDEX people_pkey ON public.people USING btree (id)",
            "CREATE INDEX people_email ON public.people USING btree (email)",
            "CREATE INDEX people_joined ON public.people USING btree (joined) WHERE (joined IS NOT NULL)",
            "CREATE INDEX people_lower_name ON public.people USING btree (lower(name))",
            "CREATE INDEX people_name ON public.people USING btree (name)",
          ],
        },
        {
          name: "orders",
          kind: "table",
          columns: [
            { name: "id", type: "bigint", notNull: true },
            { name: "person", type: "integer" },
            { name: "total", type: "numeric(10,2)" },
            { name: "weight", type: "double precision" },
          ],
          indexes: [
            "CREATE UNIQUE INDEX orders_pkey ON public.orders USING btree (id)",
            "CREATE INDEX orders_person ON public.orders USING btree (person)",
          ],
        },
        { name: "tags", kind: "table", columns: [{ name: "label", type: "text" }] },
        { name: "big_orders", kind: "view", columns: [{ name: "id", type: "bigint" }] },
        {
          name: "odd",
          kind: "table",
          columns: [
            { name: "Order", type: "integer" },
            { name: "user", type: "text" },
            { name: "plain", type: "text" },
          ],
        },
      ],
      routines: [],
    },
  ],
};

export type Warning = {
  from: number;
  to: number;
  kind: string;
  rule?: string;
  message: string;
  fix?: { title: string; text: string };
};

/** The warnings of `sql`: the checker's problems of kind "warning". */
export async function warningsIn(
  sql: string,
  more: Partial<Check> & { warnings?: boolean; off?: string[] } = {},
  model: SchemaModel | null = WARN_MODEL,
) {
  const c = await checker();
  const all = c.check({ sql, warnings: true, ...more } as Check, model).problems as Warning[];
  return all.filter((p) => p.kind === "warning");
}

/** The warnings of `sql` as the text each underlines and its identifier. */
export async function warned(sql: string, more = {}, model: SchemaModel | null = WARN_MODEL) {
  return (await warningsIn(sql, more, model)).map((w) => [sql.slice(w.from, w.to), w.rule]);
}

/** `sql` with the fix of its only warning applied, or null when it has none. */
export async function fixed(sql: string, model: SchemaModel | null = WARN_MODEL) {
  const found = await warningsIn(sql, {}, model);
  if (found.length !== 1) throw new Error(`${sql}: ${found.length} warnings`);
  const [w] = found as [Warning];
  return w.fix ? `${sql.slice(0, w.from)}${w.fix.text}${sql.slice(w.to)}` : null;
}
