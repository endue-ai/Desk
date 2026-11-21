// A PostgreSQL catalog for the schema cache's tests: schemas with their fingerprint, tables (with
// columns, constraints, indexes, triggers) and routines, answered to the cache's statements in the
// columns PostgreSQL 17 gives them (ui/schema-cache/kinds.js), through the scripted server. A test
// changes the model and its marks to play a DDL statement in another session. NULL is printed as
// '' (as the psql path printed it), which the cache reads as absent. Nothing needs Node.
import type { Script } from "./clients";

export interface PgTable {
  name: string;
  /** relkind: r, p, v, m, f, S */
  kind?: string;
  estimate?: string;
  comment?: string;
  /** name, type, flags (n not null, p primary key), default, comment */
  columns?: string[][];
  /** contype, name, definition, columns, referenced schema, table, columns */
  constraints?: [string, string, string, string[], string?, string?, string[]?][];
  /** name, definition, "c" when a constraint owns it */
  indexes?: string[][];
  /** name, definition */
  triggers?: string[][];
}
export interface PgSchema {
  mark: string;
  system?: boolean;
  tables?: PgTable[];
  /** name, identity arguments, prokind, result, oid, comment */
  routines?: string[][];
}
export type PgCatalog = Record<string, PgSchema>;

/** The schemas a statement names in `n.nspname IN (...)`. */
export function schemasOf(sql: string): string[] {
  const list = /n\.nspname IN \(([^)]*)\)/u.exec(sql)?.[1] ?? "";
  return [...list.matchAll(/'((?:[^']|'')*)'/gu)].map((m) => (m[1] ?? "").replaceAll("''", "'"));
}

/** Which of the cache's statements a SQL text is, or undefined for another one. */
export function kindOf(sql: string) {
  if (sql.includes("xmin::text::bigint") && sql.includes("concat_ws")) return "marks";
  if (sql.startsWith("SELECT n.nspname, c.relname, c.relkind::text")) return "relations";
  if (sql.startsWith("SELECT n.nspname, c.relname, a.attname")) return "columns";
  if (sql.startsWith("SELECT n.nspname, c.relname, k.contype::text")) return "constraints";
  if (sql.startsWith("SELECT n.nspname, c.relname, x.relname")) return "indexes";
  if (sql.startsWith("SELECT n.nspname, c.relname, t.tgname")) return "triggers";
  if (sql.startsWith("SELECT n.nspname, p.proname")) return "routines";
  return undefined;
}

/** The rows a statement of the cache answers from the model, the header first. */
export function answer(model: PgCatalog, sql: string): string[][] | undefined {
  const kind = kindOf(sql);
  if (!kind) return undefined;
  if (kind === "marks")
    return [
      ["nspname", "case", "concat_ws"],
      ...Object.entries(model)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, s]) => [name, s.system ? "s" : "", s.mark]),
    ];
  const out: string[][] = [];
  for (const name of schemasOf(sql).sort()) {
    const schema = model[name];
    if (!schema) continue;
    const tables = [...(schema.tables ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    for (const t of tables) {
      if (kind === "relations")
        out.push([
          name,
          t.name,
          t.kind ?? "r",
          t.estimate ?? "",
          String(1000 + out.length),
          t.comment ?? "",
        ]);
      if (kind === "columns")
        for (const [col, type, flags = "", def = "", note = ""] of t.columns ?? [])
          out.push([name, t.name, col ?? "", type ?? "", flags, def, note]);
      const byName = <T extends unknown[]>(rows: T[] | undefined, at: number) =>
        [...(rows ?? [])].sort((a, b) => String(a[at]).localeCompare(String(b[at])));
      if (kind === "constraints")
        for (const [type, cname, def, cols, rs = "", rt = "", rc] of byName(t.constraints, 1))
          out.push([
            name,
            t.name,
            type,
            cname,
            def,
            JSON.stringify(cols),
            rs,
            rt,
            rc ? JSON.stringify(rc) : "",
          ]);
      if (kind === "indexes")
        for (const [iname, def, owned = ""] of byName(t.indexes, 0))
          out.push([name, t.name, iname ?? "", def ?? "", owned]);
      if (kind === "triggers")
        for (const [tname, def] of byName(t.triggers, 0))
          out.push([name, t.name, tname ?? "", def ?? ""]);
    }
    if (kind === "routines")
      for (const [rname, args, prokind, result, oid, note = ""] of [
        ...(schema.routines ?? []),
      ].sort((a, b) => (a[0] ?? "").localeCompare(b[0] ?? "")))
        out.push([name, rname ?? "", args ?? "", prokind ?? "f", result ?? "", oid ?? "", note]);
  }
  return [Array.from({ length: out[0]?.length ?? 1 }, (_, i) => `c${i}`), ...out];
}

/** The scripted server over the model; `other` answers every statement that is not the cache's. */
export function catalogScript(
  model: () => PgCatalog,
  other: Script = () => ({}),
  seen: string[] = [],
): Script {
  return (sql, env) => {
    const rows = answer(model(), sql);
    if (!rows) return other(sql, env);
    seen.push(sql);
    // Fields as they are: the scripted server (clients.ts) hands them over as text.
    return { rows };
  };
}

/** A small shop: public (people, orders with a foreign key, a view, a routine) and sales. */
export function shop(): PgCatalog {
  return {
    information_schema: { mark: "1.-", system: true, tables: [{ name: "tables", kind: "v" }] },
    pg_catalog: { mark: "2.-", system: true, tables: [{ name: "pg_class" }] },
    public: {
      mark: "10.3:300",
      tables: [
        {
          name: "people",
          estimate: "4",
          comment: "Who buys",
          columns: [
            ["id", "integer", "np", "nextval('people_id_seq'::regclass)"],
            ["name", "text", "n", "", "Full name"],
            ["joined", "timestamp with time zone", "", "now()"],
          ],
          constraints: [["p", "people_pkey", "PRIMARY KEY (id)", ["id"]]],
          indexes: [
            [
              "people_pkey",
              "CREATE UNIQUE INDEX people_pkey ON public.people USING btree (id)",
              "c",
            ],
            ["people_name", "CREATE INDEX people_name ON public.people USING btree (name)"],
          ],
          triggers: [
            [
              "people_touch",
              "CREATE TRIGGER people_touch BEFORE UPDATE ON people FOR EACH ROW EXECUTE FUNCTION touch()",
            ],
          ],
        },
        {
          name: "orders",
          estimate: "2",
          columns: [
            ["id", "integer", "np"],
            ["person", "integer", ""],
            ["total", "numeric(10,2)", ""],
          ],
          constraints: [
            ["p", "orders_pkey", "PRIMARY KEY (id)", ["id"]],
            [
              "f",
              "orders_person_fkey",
              "FOREIGN KEY (person) REFERENCES people(id)",
              ["person"],
              "public",
              "people",
              ["id"],
            ],
            ["c", "orders_total_check", "CHECK (total >= 0::numeric)", ["total"]],
          ],
        },
        { name: "big_orders", kind: "v", columns: [["id", "integer"]] },
        { name: "people_id_seq", kind: "S" },
      ],
      routines: [
        ["touch", "", "f", "trigger", "16404", "Sets updated"],
        ["refund", "order_id integer", "p", "", "16405"],
      ],
    },
    sales: {
      mark: "11.1:200",
      tables: [{ name: "leads", estimate: "0", columns: [["id", "bigint", "np"]] }],
    },
  };
}
