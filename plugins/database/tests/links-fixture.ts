// Tables joined by declared foreign keys, for following keys from the grid (PG-41, #468): the shop's
// people and orders (pg-catalog.ts) with their rows, which the fixture's PostgreSQL connection pages
// (fixtures-pg.ts), and a catalog of its own for the plugin's tests: people with 60 rows, orders
// pointing at them, staff pointing at itself, lines keyed on two columns, notes pointing at a line by
// both, and archive.old_orders pointing at people from another schema. The scripted server answers
// a table view's page and count and the search of a referenced table, under the conditions the
// plugin writes (`"c" = 1`, `"c" > 'x'`, `CAST("c" AS text) ILIKE '%x%' ESCAPE '!'`). Fixture data.
import type { Script } from "./clients";
import { catalogScript, type PgCatalog } from "./pg-catalog";

type Rows = string[][];

/** The shop's people and orders, as fixture-pg pages them; the header first. */
export const SHOP_ROWS: Record<string, Rows> = {
  "public.people": [
    ["id", "name", "joined"],
    ["1", "Ada", "2026-11-01 09:00:00+00"],
    ["2", "Bob", "2026-11-02 10:30:00+00"],
    ["3", "Cy", "2026-11-03 11:45:00+00"],
  ],
  "public.orders": [
    ["id", "person", "total"],
    ["1", "1", "12.00"],
    ["2", "2", "30.00"],
    ["3", "1", "7.50"],
  ],
};

const many = Array.from({ length: 57 }, (_, i) => [
  String(i + 4),
  `P${String(i + 4).padStart(2, "0")}`,
]);

/** The links catalog's rows. */
export const LINKS_ROWS: Record<string, Rows> = {
  "public.people": [["id", "name"], ["1", "Ada"], ["2", "Bob"], ["3", "Cy"], ...many],
  "public.orders": SHOP_ROWS["public.orders"] ?? [],
  "public.staff": [
    ["id", "name", "boss"],
    ["1", "Ada", ""],
    ["2", "Bob", "1"],
    ["3", "Cy", "2"],
  ],
  "public.lines": [
    ["order_id", "line", "item"],
    ["1", "1", "pen"],
    ["1", "2", "ink"],
    ["2", "1", "pad"],
  ],
  "public.notes": [
    ["id", "order_id", "line", "body"],
    ["1", "1", "2", "Blue ink"],
    ["2", "2", "1", "Ruled"],
  ],
  "archive.old_orders": [
    ["id", "person"],
    ["9", "1"],
  ],
};

const fk = (name: string, cols: string[], schema: string, table: string, refs: string[]) =>
  [
    "f",
    name,
    `FOREIGN KEY (${cols.join(", ")}) REFERENCES ${table}(${refs.join(", ")})`,
    cols,
    schema,
    table,
    refs,
  ] as [string, string, string, string[], string, string, string[]];
const pk = (name: string, cols: string[]) =>
  ["p", name, `PRIMARY KEY (${cols.join(", ")})`, cols] as [string, string, string, string[]];

/** The catalog the schema cache reads for the links tests. */
export function linksCatalog(): PgCatalog {
  return {
    "": { mark: "1.-" },
    public: {
      mark: "10.1:100",
      tables: [
        {
          name: "people",
          columns: [
            ["id", "integer", "np"],
            ["name", "text", "n"],
          ],
          constraints: [pk("people_pkey", ["id"])],
        },
        {
          name: "orders",
          columns: [
            ["id", "integer", "np"],
            ["person", "integer", ""],
            ["total", "numeric(10,2)", ""],
          ],
          constraints: [
            pk("orders_pkey", ["id"]),
            fk("orders_person_fkey", ["person"], "public", "people", ["id"]),
          ],
        },
        {
          name: "staff",
          columns: [
            ["id", "integer", "np"],
            ["name", "text", ""],
            ["boss", "integer", ""],
          ],
          constraints: [
            pk("staff_pkey", ["id"]),
            fk("staff_boss_fkey", ["boss"], "public", "staff", ["id"]),
          ],
        },
        {
          name: "lines",
          columns: [
            ["order_id", "integer", "np"],
            ["line", "integer", "np"],
            ["item", "text", ""],
          ],
          constraints: [
            pk("lines_pkey", ["order_id", "line"]),
            fk("lines_order_id_fkey", ["order_id"], "public", "orders", ["id"]),
          ],
        },
        {
          name: "notes",
          columns: [
            ["id", "integer", "np"],
            ["order_id", "integer", ""],
            ["line", "integer", ""],
            ["body", "text", ""],
          ],
          constraints: [
            pk("notes_pkey", ["id"]),
            fk("notes_line_fkey", ["order_id", "line"], "public", "lines", ["order_id", "line"]),
          ],
        },
      ],
    },
    archive: {
      mark: "11.1:100",
      tables: [
        {
          name: "old_orders",
          columns: [
            ["id", "integer", "np"],
            ["person", "integer", ""],
          ],
          constraints: [
            pk("old_orders_pkey", ["id"]),
            fk("old_orders_person_fkey", ["person"], "public", "people", ["id"]),
          ],
        },
      ],
    },
  };
}

const NAME = /^"((?:[^"]|"")*)"$/u;
const unquote = (text: string) =>
  (NAME.exec(text.trim())?.[1] ?? text.trim()).replaceAll('""', '"');
const COMPARE = /^"((?:[^"]|"")*)" (=|>|<) (?:'((?:[^']|'')*)'|(-?[\d.]+))$/u;
const ILIKE = /^CAST\("((?:[^"]|"")*)" AS text\) ILIKE '((?:[^']|'')*)' ESCAPE '!'$/u;

/** Whether a row holds one condition the plugin writes; another one never holds. */
function holds(head: string[], row: string[], condition: string) {
  const at = (name = "") => row[head.indexOf(name)] ?? "";
  const compare = COMPARE.exec(condition.trim());
  if (compare) {
    const value = at(compare[1]);
    const want = (compare[3] ?? compare[4] ?? "").replaceAll("''", "'");
    if (value === "") return false;
    const by = compare[4] !== undefined ? Number(value) - Number(want) : value.localeCompare(want);
    return compare[2] === "=" ? by === 0 : compare[2] === ">" ? by > 0 : by < 0;
  }
  const like = ILIKE.exec(condition.trim());
  if (like) {
    const needle = (like[2] ?? "")
      .replaceAll("''", "'")
      .replace(/^%|%$/gu, "")
      .replace(/!(.)/gu, "$1")
      .toLowerCase();
    return at(like[1]).toLowerCase().includes(needle);
  }
  return false;
}

const kept = (rows: Rows, where = "", join = " AND ") => {
  const [head = [], ...body] = rows;
  const parts = where ? where.split(join) : [];
  const test = (row: string[]) =>
    join === " AND "
      ? parts.every((p) => holds(head, row, p))
      : parts.some((p) => holds(head, row, p));
  return { head, body: parts.length ? body.filter(test) : body };
};
const byKeys = (head: string[], order: string) => (a: string[], b: string[]) => {
  for (const part of order.split(", ")) {
    const [name = "", direction] = part.trim().split(/ (?=ASC$|DESC$)/u);
    const c = head.indexOf(unquote(name));
    const by = Number(a[c]) - Number(b[c]) || (a[c] ?? "").localeCompare(b[c] ?? "");
    if (by) return direction === "DESC" ? -by : by;
  }
  return 0;
};
const nulls = (rows: Rows) => rows.map((row) => row.map((v) => (v === "" ? null : v)));

const PAGE =
  /^SELECT \* FROM "(\w+)"\."(\w+)"(?: WHERE (.+?))?(?: ORDER BY (.+?))? LIMIT (\d+) OFFSET (\d+)$/u;
const COUNT = /^SELECT count\(\*\) FROM "(\w+)"\."(\w+)"(?: WHERE (.+))?$/u;
const SEARCH =
  /^SELECT ((?:"\w+", )*"\w+") FROM "(\w+)"\."(\w+)"(?: WHERE (.+?))? ORDER BY (.+?) LIMIT (\d+) OFFSET (\d+)$/u;

/** A table view's page, a count or a search over `tables`; undefined for any other statement. */
export function pagesOf(tables: Record<string, Rows>) {
  return (sql: string): { rows: (string | null)[][] } | undefined => {
    const text = sql.trim();
    const page = PAGE.exec(text);
    if (page) {
      const rows = tables[`${page[1]}.${page[2]}`];
      if (!rows) return undefined;
      const { head, body } = kept(rows, page[3]);
      if (page[4]) body.sort(byKeys(head, page[4]));
      const from = Number(page[6]);
      return { rows: [head, ...nulls(body.slice(from, from + Number(page[5])))] };
    }
    const count = COUNT.exec(text);
    if (count) {
      const rows = tables[`${count[1]}.${count[2]}`];
      return rows ? { rows: [["count"], [String(kept(rows, count[3]).body.length)]] } : undefined;
    }
    const search = SEARCH.exec(text);
    if (search) {
      const rows = tables[`${search[2]}.${search[3]}`];
      if (!rows) return undefined;
      const { head, body } = kept(rows, search[4], " OR ");
      body.sort(byKeys(head, search[5] ?? ""));
      const names = (search[1] ?? "").split(", ").map(unquote);
      const from = Number(search[7]);
      const cut = body.slice(from, from + Number(search[6]));
      return {
        rows: [names, ...nulls(cut.map((row) => names.map((n) => row[head.indexOf(n)] ?? "")))],
      };
    }
    return undefined;
  };
}

/** The links catalog's scripted server: the cache's statements, then pages; `seen` every SQL. */
export function linksServer(seen: string[] = []): Script {
  const pages = pagesOf(LINKS_ROWS);
  return catalogScript(linksCatalog, (sql) => {
    seen.push(sql);
    return pages(sql) ?? {};
  });
}
