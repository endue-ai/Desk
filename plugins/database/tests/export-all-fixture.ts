// A whole export on the fixture's PostgreSQL server (PG-64), for the runtime page: the export's
// transaction and the server version, `public.items` described (six columns, their types), and the
// COPY of it as the server's CSV or text format, the fixture's three items. Every other statement
// goes to `script`. Fixture data only.
import type { Script } from "./clients";
import { COPY_ITEMS } from "./copy-fixture";

const COLUMNS = ["id", "mood", "doc", "ok", "tags", "at"];
const TYPES = [23, 16_400, 3802, 16, 1009, 1184];
const NAMES = ["integer", "mood", "jsonb", "boolean", "text[]", "timestamp with time zone"];
const csvField = (v: string) =>
  /[",\n\r]/u.test(v) || v === "" ? `"${v.replaceAll('"', '""')}"` : v;
/** The items as `COPY ... TO STDOUT WITH (FORMAT csv, HEADER)` writes them. */
export const EXPORT_ITEMS_CSV = `${COLUMNS.join(",")}\n${COPY_ITEMS.split("\n")
  .filter(Boolean)
  .map((line) => line.split("\t").map(csvField).join(","))
  .join("\n")}\n`;

export function exportAllScript(script: Script): Script {
  return (sql, who, bound) => {
    if (sql.startsWith("START TRANSACTION ISOLATION LEVEL")) return {};
    if (sql.startsWith("SELECT current_setting('server_version_num')"))
      return { rows: [["current_setting"], ["170000"]] };
    if (/^SELECT \* FROM \(\n.*"items".*\n\) AS endue_export LIMIT 0$/su.test(sql))
      return { rows: [COLUMNS], types: TYPES };
    if (sql.startsWith("SELECT oid::int4, format_type"))
      return {
        rows: [["oid", "format_type"], ...TYPES.map((t, i) => [String(t), NAMES[i] ?? ""])],
      };
    if (/^COPY \(\n.*"items".*\n\) TO STDOUT WITH \(FORMAT csv/su.test(sql))
      return { copy: { direction: "out", data: EXPORT_ITEMS_CSV } };
    if (/^COPY \(\n.*"items".*\n\) TO STDOUT/su.test(sql))
      return { copy: { direction: "out", data: COPY_ITEMS } };
    return script(sql, who, bound);
  };
}
