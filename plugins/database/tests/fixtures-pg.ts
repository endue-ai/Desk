// The fixture's PostgreSQL connection (fixtures.ts): its scripted server answers the catalog of one
// table of typed columns, public.items (an enum, jsonb, a boolean, a text array and a timestamp with
// a time zone), the types query of the typed cell editors (ui/cell-editors/pg-types.js), the table's
// page and its count. Every other statement gets nothing back. Fixture data only.
import type { Connection } from "../ui/engines/common.js";
import type { Answer } from "./clients";

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

export function pgFixtureScript(sql: string): Answer {
  const text = sql.trim();
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
  return {};
}
