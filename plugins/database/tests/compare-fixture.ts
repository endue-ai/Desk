// The table the comparison's tests and the runtime fixture page read (PG-26): `stock`, whose rows
// change from one read of `select * from stock` (or of its table view's page) to the next (a price changed, a row gone, one
// added, a column added), with `id` its primary key in SQLite's catalog; `select * from stock_v1`
// and `stock_v2` read one version each, always. Every other statement goes to the script it wraps.
// Fixture data only.
import type { Answer, Script } from "./clients";

export const STOCK_V1 = [
  ["id", "item", "price"],
  ["1", "pen", "2.25"],
  ["2", "ink", "4.75"],
  ["3", "pad", "3.25"],
  ["4", "clip", "0.15"],
];
export const STOCK_V2 = [
  ["id", "item", "price", "shelf"],
  ["1", "pen", "2.25", "A"],
  ["2", "ink", "4.95", "A"],
  ["4", "clip", "0.15", "B"],
  ["5", "tape", "1.95", "B"],
];

/** name, type, nullable, default, primary: as the SQLite catalog query reads them. */
const COLUMNS = [
  ["name", "type", "nullable", "default", "primary"],
  ["id", "INTEGER", "NO", "", "YES"],
  ["item", "TEXT", "YES", "", "NO"],
  ["price", "TEXT", "YES", "", "NO"],
  ["shelf", "TEXT", "YES", "", "NO"],
];

/** The script with `stock` in front: its reads alternate between the two versions, v1 first. */
export function stockScript(next: Script): Script {
  let reads = 0;
  return (sql, who): Answer | "auth" => {
    const text = sql.trim().replace(/;$/u, "");
    if (/^SELECT name, type, .*pragma_table_info\('stock(?:_v[12])?'\)/u.test(text))
      return { rows: COLUMNS };
    if (/^select \* from stock_v1$/iu.test(text)) return { rows: STOCK_V1 };
    if (/^select \* from stock_v2$/iu.test(text)) return { rows: STOCK_V2 };
    // A console's read, and a table view's page of it.
    if (
      /^select \* from stock$/iu.test(text) ||
      /^SELECT \* FROM "stock" LIMIT \d+ OFFSET 0$/u.test(text)
    )
      return { rows: reads++ % 2 ? STOCK_V2 : STOCK_V1 };
    return next(sql, who);
  };
}
