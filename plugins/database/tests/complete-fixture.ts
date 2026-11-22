// Fixtures for the statement's completion (PG-31, ADR 0327): a schema model as the schema cache answers
// it, with foreign keys both ways (one of two columns, one to itself), comments, defaults, a name that
// needs quoting and routines (overloads, a TABLE function, a SETOF function), and the parse worker's
// service in process, so a completion runs the real grammar and resolver over the console's state the
// problems check keeps. `at("select | from t")` completes at the bar.
import type { SchemaModel } from "../ui/sql/parse/model.js";
import { createService } from "../ui/sql/parse/worker.js";
import { loadRaw } from "./problems-fixture";

type Column = { name: string; type: string; comment?: string; default?: boolean };
const cols = (...list: Array<string | [string, string, string?]>): Column[] =>
  list.map((c) =>
    typeof c === "string"
      ? { name: c, type: "integer" }
      : { name: c[0], type: c[1], ...(c[2] ? { comment: c[2] } : {}) },
  );
const fk = (columns: string[], table: string, refColumns: string[], schema = "public") => ({
  columns,
  schema,
  table,
  refColumns,
});

export const COMPLETE_MODEL: SchemaModel = {
  schemas: [
    {
      name: "public",
      relations: [
        {
          name: "customers",
          kind: "table",
          comment: "Who buys",
          columns: cols("id", ["name", "text", "Full name"], ["email", "text"]),
        },
        {
          name: "orders",
          kind: "table",
          columns: [
            { name: "id", type: "integer", default: true },
            { name: "customer_id", type: "integer" },
            { name: "total", type: "numeric(10,2)" },
            { name: "placed_at", type: "timestamp with time zone", default: true },
            { name: "note", type: "text" },
          ],
          foreignKeys: [fk(["customer_id"], "customers", ["id"])],
        },
        {
          name: "order_items",
          kind: "table",
          columns: cols("order_id", "line", "product_id", "qty"),
          foreignKeys: [fk(["order_id"], "orders", ["id"]), fk(["product_id"], "products", ["id"])],
        },
        {
          name: "products",
          kind: "table",
          columns: cols("id", ["name", "text"], ["price", "numeric"]),
        },
        {
          name: "employees",
          kind: "table",
          columns: cols("id", ["name", "text"], "manager_id"),
          foreignKeys: [fk(["manager_id"], "employees", ["id"])],
        },
        {
          name: "shipments",
          kind: "table",
          columns: cols("order_id", "line", ["at", "timestamp with time zone"]),
          foreignKeys: [fk(["order_id", "line"], "order_items", ["order_id", "line"])],
        },
        {
          name: "Odd Table",
          kind: "table",
          columns: cols("id", ["Weird Col", "text"], ["user", "text"], ["between", "text"]),
        },
        { name: "big_orders", kind: "view", columns: cols("id", ["total", "numeric(10,2)"]) },
      ],
      routines: [
        { name: "add", kind: "function", args: "a integer, b integer", result: "integer" },
        { name: "add", kind: "function", args: "a numeric, b numeric", result: "numeric" },
        {
          name: "customer_orders",
          kind: "function",
          args: "c integer",
          result: "TABLE(id integer, total numeric)",
          comment: "Orders of a customer",
        },
        { name: "all_orders", kind: "function", args: "", result: "SETOF orders" },
      ],
      types: [{ name: "mood", type: "enum" }],
    },
    {
      name: "app",
      relations: [{ name: "people", kind: "table", columns: cols("id", ["email", "text"]) }],
      routines: [],
    },
  ],
} as SchemaModel;

export type Item = {
  label: string;
  kind: string;
  detail: string;
  insert: string;
  info?: string;
  snippet?: boolean;
  range?: { from: number; to: number };
  key: string;
};
export type Signature = {
  name: string;
  at: number;
  arg: number;
  active: number;
  overloads: Array<{ label: string; args: string[]; result: string; comment: string }>;
};
export type Completion = {
  from: number;
  to: number;
  items: Item[];
  place: string;
  signature?: Signature | null;
};
type Options = {
  doc?: string;
  searchPath?: string[];
  picks?: Record<string, [number, number]>;
  want?: "items" | "signature" | "star";
  snippets?: Array<{ name: string; template: string; where: string; own?: boolean }>;
};

/** The worker's service over the parser, every text it parses recorded in `parsed`. */
export async function completer(model: SchemaModel = COMPLETE_MODEL) {
  const real = await loadRaw();
  const parsed: string[] = [];
  const raw = {
    ...real,
    parse: (sql: string) => {
      parsed.push(sql);
      return real.parse(sql);
    },
    broken: () => real.broken(),
  };
  const service = createService(raw);
  service.answer({ type: "model", key: 1, model });
  let id = 0;
  const ask = (request: Record<string, unknown>) => {
    const reply = service.answer({ id: ++id, ...request } as never) as
      | { result: unknown }
      | { error: string };
    if ("error" in reply) throw new Error(reply.error);
    return reply.result;
  };
  /** The statement around the caret, as the editor sends it: after the `;` before, to the next. */
  const windowOf = (script: string, caret: number) => {
    const from = script.lastIndexOf(";", caret - 1) + 1;
    const next = script.indexOf(";", caret);
    return { text: script.slice(from, next < 0 ? script.length : next), from };
  };
  return {
    parsed,
    /** The problems check of a whole script, which keeps the console's statements. */
    check: (sql: string, doc = "d", searchPath?: string[]) =>
      ask({ type: "check", doc, sql, model: 1, syntax: true, names: true, searchPath }),
    /** The completion at `|` in a script: the statement around it goes, with where it starts. */
    at(sql: string, options: Options = {}): Completion {
      const caret = sql.indexOf("|");
      const script = sql.replace("|", "");
      const { text, from } = windowOf(script, caret);
      return ask({
        type: "complete",
        doc: options.doc ?? "d",
        sql: text,
        caret: caret - from,
        offset: from,
        model: 1,
        ...(options.searchPath ? { searchPath: options.searchPath } : {}),
        ...(options.picks ? { picks: options.picks } : {}),
        ...(options.want ? { want: options.want } : {}),
        ...(options.snippets ? { snippets: options.snippets } : {}),
      }) as Completion;
    },
  };
}

/** The labels of the items of one kind. */
export const labelsOf = (found: Completion, kind?: string) =>
  found.items.filter((i) => !kind || i.kind === kind).map((i) => i.label);
