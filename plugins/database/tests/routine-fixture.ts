// A scripted PostgreSQL server for the routine forms (ui/features/routines/), on any connection:
// schema public's functions and procedures as pg_proc and pg_type would answer the forms' reads,
// and what each call returns. add_tax has named arguments and a default, area is overloaded,
// recent_orders returns a table and takes an enum, total_of is VARIADIC, restock is a procedure
// with INOUT and OUT and a notice, archive_orders is a VOLATILE function, nightly_close a
// procedure that commits, audit_trigger a trigger function. Every call and transaction statement
// is kept in `ran`. The unit tests and the runtime e2e page (packages/runtime/e2e/fixture/
// database.ts) share it; it needs no Node.
import type { Answer, Script } from "./clients";

type Row = string[];
interface Fixture {
  oid: string;
  name: string;
  prokind: "f" | "p";
  volatility: "i" | "s" | "v";
  set: boolean;
  identity: string;
  result: string;
  language: string;
  returns: [string, string];
  controls: boolean;
  /** n, name, mode, format_type, typtype, typname, base, category, element, its category, labels, default */
  args: Row[];
  answer(call: string): Answer;
}

const numeric = (n: string, name: string, def = "") => [
  ...[n, name, "i", "numeric", "b", "numeric", "numeric", "N", "", "", "{}"],
  def,
];
const num = (call: string, name: string) =>
  Number(new RegExp(`${name} => '?(-?[0-9.]+)'?::numeric`, "u").exec(call)?.[1] ?? Number.NaN);

export const ROUTINES: Fixture[] = [
  {
    ...{ oid: "9001", name: "add_tax", prokind: "f", volatility: "i", set: false },
    ...{ identity: "amount numeric, rate numeric", result: "numeric", language: "sql" },
    ...{ returns: ["b", "numeric"], controls: false },
    args: [numeric("1", "amount"), numeric("2", "rate", "0.2")],
    answer: (call) => {
      const rate = /rate =>/u.test(call) ? num(call, "rate") : 0.2;
      return { rows: [["add_tax"], [(num(call, "amount") * (1 + rate)).toFixed(2)]] };
    },
  },
  {
    ...{ oid: "9002", name: "area", prokind: "f", volatility: "i", set: false },
    ...{ identity: "r numeric", result: "numeric", language: "sql" },
    ...{ returns: ["b", "numeric"], controls: false },
    args: [numeric("1", "r")],
    answer: (call) => ({ rows: [["area"], [(Math.PI * num(call, "r") ** 2).toFixed(2)]] }),
  },
  {
    ...{ oid: "9003", name: "area", prokind: "f", volatility: "i", set: false },
    ...{ identity: "w numeric, h numeric", result: "numeric", language: "sql" },
    ...{ returns: ["b", "numeric"], controls: false },
    args: [numeric("1", "w"), numeric("2", "h")],
    answer: (call) => ({ rows: [["area"], [String(num(call, "w") * num(call, "h"))]] }),
  },
  {
    ...{ oid: "9004", name: "recent_orders", prokind: "f", volatility: "s", set: true },
    ...{ identity: "since date, status order_status", language: "sql", controls: false },
    ...{ result: "TABLE(id integer, total numeric)", returns: ["p", "record"] },
    args: [
      ["1", "since", "i", "date", "b", "date", "date", "D", "", "", "{}", ""],
      [
        ...["2", "status", "i", "order_status", "e", "order_status", "order_status", "E"],
        ...["", "", "{new,paid,shipped}", "'paid'::order_status"],
      ],
      ["3", "id", "t", "integer", "b", "int4", "int4", "N", "", "", "{}", ""],
      ["4", "total", "t", "numeric", "b", "numeric", "numeric", "N", "", "", "{}", ""],
    ],
    answer: () => ({
      rows: [
        ["id", "total"],
        ["101", "40.00"],
        ["102", "12.50"],
      ],
    }),
  },
  {
    ...{ oid: "9005", name: "total_of", prokind: "f", volatility: "i", set: false },
    ...{ identity: "VARIADIC amounts integer[]", result: "integer", language: "sql" },
    ...{ returns: ["b", "int4"], controls: false },
    args: [["1", "amounts", "v", "integer[]", "b", "_int4", "_int4", "A", "int4", "N", "{}", ""]],
    answer: (call) => {
      const list = /'\{([^}]*)\}'::integer\[\]/u.exec(call)?.[1] ?? "";
      const sum = list ? list.split(",").reduce((n, v) => n + Number(v), 0) : 0;
      return { rows: [["total_of"], [String(sum)]] };
    },
  },
  {
    ...{ oid: "9006", name: "restock", prokind: "p", volatility: "v", set: false },
    ...{
      identity: "IN item text, OUT note text, INOUT qty integer",
      result: "",
      language: "plpgsql",
    },
    ...{ returns: ["p", "void"], controls: false },
    args: [
      ["1", "item", "i", "text", "b", "text", "text", "S", "", "", "{}", ""],
      ["2", "note", "o", "text", "b", "text", "text", "S", "", "", "{}", ""],
      ["3", "qty", "b", "integer", "b", "int4", "int4", "N", "", "", "{}", "1"],
    ],
    answer: (call) => {
      const item = /item => '([^']*)'/u.exec(call)?.[1] ?? "";
      const qty = Number(/qty => (\d+)::integer/u.exec(call)?.[1] ?? 1);
      return {
        rows: [
          ["note", "qty"],
          [`restocked ${item}`, String(qty + 5)],
        ],
        notices: [`NOTICE:  restocking ${item}`],
      };
    },
  },
  {
    ...{ oid: "9007", name: "archive_orders", prokind: "f", volatility: "v", set: false },
    ...{ identity: "before date", result: "integer", language: "plpgsql" },
    ...{ returns: ["b", "int4"], controls: false },
    args: [["1", "before", "i", "date", "b", "date", "date", "D", "", "", "{}", ""]],
    answer: () => ({ rows: [["archive_orders"], ["3"]], notices: ["NOTICE:  3 orders archived"] }),
  },
  {
    ...{ oid: "9008", name: "nightly_close", prokind: "p", volatility: "v", set: false },
    ...{ identity: "", result: "", language: "plpgsql", returns: ["p", "void"], controls: true },
    args: [],
    answer: () => ({ changes: 0 }),
  },
  {
    ...{ oid: "9009", name: "audit_trigger", prokind: "f", volatility: "v", set: false },
    ...{ identity: "", result: "trigger", language: "plpgsql", returns: ["p", "trigger"] },
    controls: false,
    args: [],
    answer: () => ({ error: "trigger functions can only be called as triggers" }),
  },
];

export interface RoutineServer {
  script: Script;
  /** Every call, BEGIN and ROLLBACK, in order. */
  ran: string[];
}

/** The scripted server; anything else goes to `fallback` (another fixture's script). */
export function routineServer(fallback: Script = () => ({}), version = "170006"): RoutineServer {
  const byOid = (text: string) => {
    const oid = /WHERE p\.oid = (\d+)/u.exec(text)?.[1];
    return ROUTINES.find((r) => r.oid === oid);
  };
  const server: RoutineServer = {
    ran: [],
    script: (sql, env) => {
      const text = sql.trim();
      if (text.startsWith("SELECT p.oid::text, n.nspname, p.proname, pg_catalog.pg_get_function")) {
        const name = /p\.proname = '([^']+)'/u.exec(text)?.[1];
        const schema = /n\.nspname = '([^']+)'/u.exec(text)?.[1];
        const listed = ROUTINES.filter(
          (r) => (!name || r.name === name) && (!schema || schema === "public"),
        ).map((r) => [
          ...[r.oid, "public", r.name, r.identity, r.prokind === "p" ? "procedure" : "function"],
          r.result,
        ]);
        return { rows: [["oid", "nspname", "proname", "args", "kind", "result"], ...listed] };
      }
      if (text.startsWith("SELECT p.oid::text, n.nspname, p.proname, p.prokind::text")) {
        const r = byOid(text);
        const row = r
          ? [
              ...[r.oid, "public", r.name, r.prokind, r.volatility, r.set ? "t" : "f"],
              ...[r.identity, r.result, r.language, ...r.returns, r.controls ? "t" : "f"],
              ...[version, "UTC"],
            ]
          : undefined;
        return { rows: [["oid"], ...(row ? [row] : [])] };
      }
      if (text.startsWith("SELECT a.n::text"))
        return { rows: [["n"], ...(byOid(text)?.args ?? [])] };
      if (text === "BEGIN" || text === "ROLLBACK") {
        server.ran.push(text);
        return {};
      }
      const called = /^(?:SELECT \* FROM |SELECT |CALL )public\.(\w+)\(/u.exec(text);
      // area is overloaded: its two arguments name w and h.
      const oid = called?.[1] === "area" ? (/w =>/u.test(text) ? "9003" : "9002") : undefined;
      const r = called && ROUTINES.find((f) => (oid ? f.oid === oid : f.name === called[1]));
      if (!r) return fallback(sql, env);
      server.ran.push(text);
      return r.answer(text);
    },
  };
  return server;
}
