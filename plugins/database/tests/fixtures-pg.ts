// The fixture's PostgreSQL connection (fixtures.ts): its scripted server answers the catalog of one
// table of typed columns, public.items (an enum, jsonb, a boolean, a text array and a timestamp with
// a time zone), the types query of the typed cell editors (ui/cell-editors/pg-types.js), the table's
// page and its count, the pages of the shop's people and orders, joined by a foreign key
// (links-fixture.ts), 3,000 rows of rows_demo (PG-22), and fails `select 1/0`. Every other statement gets nothing back. Fixture data
// only.
import type { Connection } from "../ui/engines/common.js";
import type { Answer } from "./clients";
import { pagesOf, SHOP_ROWS } from "./links-fixture";

/** The saved PostgreSQL connection the fixture page starts with, after `fixture`. */
export const FIXTURE_PG_CONNECTION: Connection = {
  id: "c-fixture-pg",
  name: "fixture-pg",
  engine: "postgresql",
  host: "db",
  port: null,
  database: "shop",
  user: "app",
  ssl: "default",
  sslCa: "",
  file: "",
  tag: "none",
  readOnly: false,
};

/** name, declared type, base, category, element, its category, labels, nullable, default, ... */
const COLUMNS = [
  ["id", "integer", "int4", "N", "", "", "{}", "NO", "NO"],
  ["mood", "mood", "mood", "E", "", "", '{sad,ok,"so so"}', "NO", "YES"],
  ["doc", "jsonb", "jsonb", "U", "", "", "{}", "YES", "NO"],
  ["flag", "boolean", "bool", "B", "", "", "{}", "YES", "NO"],
  ["tags", "text[]", "_text", "A", "text", "S", "{}", "YES", "NO"],
  ["seen", "timestamp with time zone", "timestamptz", "D", "", "", "{}", "YES", "YES"],
];
const ROWS = [
  ["1", "ok", '{"size": 1, "tags": ["a"]}', "t", "{a,b}", "2026-11-21 09:00:00+00"],
  ["2", "sad", '{"size": 2}', "f", "{}", "2026-11-20 18:30:00+00"],
  ["3", "so so", "[1, 2, 3]", "t", '{"c d"}', "2026-11-19 07:15:00+00"],
];

const shopPages = pagesOf(SHOP_ROWS);

export function pgFixtureScript(sql: string): Answer {
  const text = sql.trim();
  const shop = shopPages(text);
  if (shop) return shop;
  if (/^SELECT nspname FROM pg_catalog\.pg_namespace/u.test(text))
    return { rows: [["nspname"], ["public"]] };
  if (/^SELECT c\.relname, CASE c\.relkind/u.test(text))
    return {
      rows: [
        ["relname", "kind", "detail", "estimate", "oid"],
        ["items", "table", "", "3", "16384"],
      ],
    };
  if (/^SELECT p\.proname/u.test(text))
    return { rows: [["proname", "kind", "result", "e", "oid"]] };
  if (/^SELECT a\.attname, pg_catalog\.format_type\(a\.atttypid, a\.atttypmod\), CASE/u.test(text))
    return {
      rows: [
        ["attname", "format_type", "nullable", "default", "primary"],
        ...COLUMNS.map(([name, type, , , , , , nullable, given]) => [
          name ?? "",
          type ?? "",
          nullable ?? "YES",
          given === "YES" ? (name === "mood" ? "'ok'::mood" : "now()") : "",
          name === "id" ? "YES" : "NO",
        ]),
      ],
    };
  // The table view's order (ui/table-order.js): a table keyed by id.
  if (/^SELECT c\.relkind, /u.test(text) && text.includes("'items'"))
    return {
      rows: [
        ["relkind", "key"],
        ["r", '"id"'],
      ],
    };
  if (/^WITH RECURSIVE d/u.test(text) && text.includes("'items'"))
    return {
      rows: [
        ["attname", "type", "base", "category", "element", "ecategory", "labels"],
        ...COLUMNS.map((column) => [...column, "", "", "UTC"]),
      ],
    };
  if (/^SELECT \* FROM "public"\."items"/u.test(text))
    return { rows: [COLUMNS.map(([name]) => name ?? ""), ...ROWS] };
  if (/^SELECT count\(\*\) FROM "public"\."items"/u.test(text))
    return { rows: [["count"], [String(ROWS.length)]] };
  // A read larger than a page, which a console reads through a cursor (PG-22).
  if (text === "select n, label from rows_demo")
    return {
      rows: [
        ["n", "label"],
        ...Array.from({ length: 3000 }, (_, i) => [`${i + 1}`, `row ${i + 1}`]),
      ],
    };
  // A statement that fails, for a console's failed transaction (PG-02).
  if (text === "select 1/0") return { error: "division by zero", code: "22012" };
  return {};
}
