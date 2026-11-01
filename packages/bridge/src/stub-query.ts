/**
 * Item queries for the browser stub (`ItemQuery` in specs/item/v0): which items match, in which order,
 * and a page at a time with an opaque cursor, the way the core's index answers them.
 */
import { StubError } from "./adapters";
import type { Item, ItemCondition, ItemPage, ItemQuery, ItemSort } from "./generated";

const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
/** What full-text search reads besides `title` and `body`. */
const TEXT_FIELDS = ["snippet", "location", "summary", "project", "path"];
const NEWEST_FIRST: ItemSort[] = [{ field: "updatedAt", dir: "desc" }];
const CURSOR = /^p[1-9][0-9]*$/;
const invalid = (why: string) => new StubError("invalid_params", why);

/** The value at a dotted path (`start`, `from.email`, `raw.labels`, `points.0.v`), or undefined. */
export function valueAt(item: Item, path: string): unknown {
  let value: unknown = item;
  for (const key of path.split(".")) {
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** How two values order: timestamps as instants (whatever their offset), numbers, then text. */
function compare(a: unknown, b: unknown): number | undefined {
  if (typeof a === "string" && typeof b === "string") {
    if (TIME.test(a) && TIME.test(b)) return Date.parse(a) - Date.parse(b);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return undefined;
}

const same = (a: unknown, b: unknown) =>
  compare(a, b) === 0 || (a !== undefined && JSON.stringify(a) === JSON.stringify(b));

function holds(item: Item, { field, op, value }: ItemCondition): boolean {
  const actual = valueAt(item, field);
  const order = compare(actual, value);
  switch (op) {
    case "eq":
      return same(actual, value);
    case "ne":
      return !same(actual, value);
    case "lt":
      return order !== undefined && order < 0;
    case "lte":
      return order !== undefined && order <= 0;
    case "gt":
      return order !== undefined && order > 0;
    case "gte":
      return order !== undefined && order >= 0;
    case "in":
      return Array.isArray(value) && value.some((v) => same(actual, v));
    case "contains":
      if (typeof actual === "string") return typeof value === "string" && actual.includes(value);
      return Array.isArray(actual) && actual.some((v) => same(v, value));
    case "exists":
      return (actual !== undefined) === (value !== false);
  }
}

/** Every word of `text` appears, in any case, in the item's title, body or text fields. */
function mentions(item: Item, text: string): boolean {
  const fields = ["title", "body", ...TEXT_FIELDS].map((field) => valueAt(item, field));
  const words = fields.filter((v): v is string => typeof v === "string").join("\n");
  const haystack = words.toLowerCase();
  return text
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

/** `connector` (every instance) or `connector/instance` (one). */
function fromSource(item: Item, selector: string): boolean {
  const [connector, instance] = selector.split("/");
  const { source } = item;
  return source.connector === connector && (instance === undefined || source.instance === instance);
}

/** A view's `$name` sources are resolved by the view engine; the index takes connector ids. */
export function checkSources(query: ItemQuery): void {
  const named = query.sources?.find((source) => source.startsWith("$"));
  if (named) throw invalid(`${named} names a view's requires entry, not a connector`);
}

/** Whether an item matches a query's kinds, sources, text and conditions (not its sort or page). */
export function matches(item: Item, query: ItemQuery): boolean {
  return (
    (query.kinds?.includes(item.kind) ?? true) &&
    (query.sources?.some((selector) => fromSource(item, selector)) ?? true) &&
    (query.text === undefined || mentions(item, query.text)) &&
    (query.where ?? []).every((condition) => holds(item, condition))
  );
}

/** By each sort entry in turn, missing values last; ties by id, so every order is stable. */
function sorted(items: Item[], sort: ItemSort[]): Item[] {
  return [...items].sort((a, b) => {
    for (const { field, dir } of sort) {
      const [x, y] = [valueAt(a, field), valueAt(b, field)];
      if (x === undefined || y === undefined) {
        if (x !== y) return x === undefined ? 1 : -1;
        continue;
      }
      const order = compare(x, y) ?? 0;
      if (order !== 0) return dir === "asc" ? order : -order;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** One page of the items a query matches; `cursor` is the page's offset, handed out here only. */
export function page(items: Item[], query: ItemQuery): ItemPage {
  checkSources(query);
  const { cursor, limit = 50 } = query;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500)
    throw invalid(`limit is ${limit}; it must be 1 to 500`);
  if (cursor !== undefined && !CURSOR.test(cursor)) throw invalid(`${cursor} is not a cursor`);
  const offset = cursor === undefined ? 0 : Number(cursor.slice(1));
  const sort = query.sort?.length ? query.sort : NEWEST_FIRST;
  const all = sorted(
    items.filter((item) => matches(item, query)),
    sort,
  );
  const next = offset + limit;
  const result: ItemPage = { items: structuredClone(all.slice(offset, next)) };
  if (next < all.length) result.cursor = `p${next}`;
  return result;
}

/** The fields items have, as dotted paths: each top-level field but `raw`, and raw's by name. */
export function fieldsOf(items: Item[]): string[] {
  const fields = new Set<string>();
  for (const item of items)
    for (const [field, value] of Object.entries(item)) {
      if (field !== "raw") fields.add(field);
      else for (const name of Object.keys(value ?? {})) fields.add(`raw.${name}`);
    }
  return [...fields].sort();
}
