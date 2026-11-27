// A PostgreSQL table for the paste tests (PG-43, #470), with its editors as the catalog gives them:
// an identity key, text, a date, a numeric, jsonb, a stored generated column, a NOT NULL text and a
// serial. Fixture data only.
import { typesOf } from "../ui/cell-editors/pg-types.js";
import { attachEditors } from "../ui/cell-editors/resolve.js";
import { targetOf } from "../ui/edit/pending.js";

/** name, declared type, base, category, nullable, has a default, generated, identity, default */
const COLUMNS = [
  ["id", "integer", "int4", "N", "NO", "YES", "", "d", null],
  ["name", "text", "text", "S", "YES", "NO", "", "", null],
  ["due", "date", "date", "D", "YES", "NO", "", "", null],
  ["amount", "numeric(8,2)", "numeric", "N", "YES", "NO", "", "", null],
  ["doc", "jsonb", "jsonb", "U", "YES", "NO", "", "", null],
  ["twice", "integer", "int4", "N", "YES", "NO", "s", "", null],
  ["note", "text", "text", "S", "NO", "YES", "", "", "''::text"],
  ["seq", "integer", "int4", "N", "NO", "YES", "", "", "nextval('t_seq_seq'::regclass)"],
] as const;

export const NAMES = COLUMNS.map(([name]) => name as string);
export const col = (name: string) => NAMES.indexOf(name);

export function pasteSet() {
  return {
    columns: [...NAMES],
    rows: [
      ["1", "Ada", "2026-11-01", "10.00", '{"a": 1}', "2", "first", "1"],
      ["2", "Bob", "2026-11-02", "20.00", "[]", "4", "second", "2"],
      ["3", "Cy", null, null, null, "6", "third", "3"],
    ] as (string | null)[][],
    truncated: false,
  };
}

const types = typesOf(
  COLUMNS.map(([name, type, base, category, nullable, given, generated, identity]) => [
    name,
    type,
    base,
    category,
    "",
    "",
    "{}",
    nullable,
    given,
    generated,
    identity,
    "UTC",
  ]),
);
const table = COLUMNS.map(([name, type, , , nullable, , , , given]) => ({
  name,
  type,
  nullable: nullable === "YES",
  default: given,
  primary: name === "id",
}));

/** The target of the table's rows, with each column's editor. */
export function pasteTarget(set = pasteSet()) {
  const made = targetOf("postgresql", { schema: "public", name: "t" }, set.columns, table);
  if (!made.target) throw new Error(made.reason);
  return attachEditors(made.target, table, types);
}

/** Where a paste lands: the block's corners on screen, the rows in screen order, the shown columns. */
export function at(
  top: number,
  left: number,
  options: { bottom?: number; right?: number; order?: number[]; columns?: number[] } = {},
) {
  return {
    order: options.order ?? [0, 1, 2],
    columns: options.columns ?? NAMES.map((_, i) => i),
    top,
    left,
    bottom: options.bottom ?? top,
    right: options.right ?? left,
  };
}
