// Walking foreign keys (PG-41, ADR 0322): from a key cell to the row it points at, from a row to the
// rows that point at it (counted when asked), and back. Each opens the other table's view, or reuses
// it, with its typed WHERE cleared and one quick filter per key column, so the row shows whatever was
// typed there; the place it came from (the buffer, and a table view's filter, order, sort keys and
// page) goes on the trail, and back shows it again as it was. No DOM.

import { tableName } from "../../catalog.js";
import { countSql, engineOf } from "../../engines/index.js";
import { filterLabel, whereWith } from "../../grid/filters.js";
import { keyFilters } from "../../links/model.js";
import { cursorOf, onScreen, readKeys } from "./read.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("../../consoles.js").Console} Console
 * @typedef {import("../../grid/filters.js").Filter} Filter
 * @typedef {import("../../links/model.js").Key} Key
 * @typedef {import("../../links/model.js").End} End
 * @typedef {import("../../links/model.js").Place} Place
 * @typedef {ReturnType<typeof import("../../links/model.js").createTrail>} Trail
 */

const COUNT = "\u0000count";

/** A buffer's place on the trail: a table view's state with it. @returns {Place} */
const placeOf = (/** @type {Console} */ target) => ({
  id: target.id,
  table: target.table
    ? {
        where: target.table.where,
        order: target.table.order,
        sort: [...(target.table.sort ?? [])],
        filters: [...(target.table.filters ?? [])],
        offset: target.table.offset,
      }
    : null,
});
const nameOf = (/** @type {Console} */ target) =>
  target.table ? `${target.table.schema}.${target.table.name}` : (target.title ?? target.name);
const said = (/** @type {Deps} */ deps, /** @type {string} */ words) => {
  deps.say(words);
  return words;
};

/** Leave `from` by `open`; once another view is on screen, `from` goes on the trail. */
async function go(
  /** @type {Deps} */ deps,
  /** @type {Trail} */ trail,
  /** @type {Console} */ from,
  /** @type {() => Promise<string>} */ open,
) {
  const place = placeOf(from);
  const shown = deps.consoles.current();
  const filters = from.table?.filters;
  try {
    return await open();
  } finally {
    if (deps.consoles.current() !== shown || from.table?.filters !== filters) trail.push(place);
  }
}

/** Open `end`'s table view filtered, the view the person already has of it too. */
async function openFiltered(
  /** @type {Deps} */ deps,
  /** @type {Connection} */ conn,
  /** @type {End} */ end,
  /** @type {Filter[]} */ filters,
) {
  const had = deps.consoles
    .list()
    .some(
      (c) =>
        c.kind === "table" &&
        c.connection === conn.id &&
        c.table?.schema === end.schema &&
        c.table?.name === end.table,
    );
  await deps.consoles.open(conn, { schema: end.schema, name: end.table, filters });
  if (had) await deps.consoles.page({ where: "", filters });
  deps.view.focus("grid");
  return `${end.schema}.${end.table} where ${filters.map(filterLabel).join(" and ")}: b goes back.`;
}

/** One of several keys, picked; a named one (`constraint`) without asking. */
async function oneOf(
  /** @type {Deps} */ deps,
  /** @type {Key[]} */ keys,
  /** @type {unknown} */ named,
  /** @type {string} */ title,
) {
  if (typeof named === "string") return keys.find((k) => k.name === named);
  if (keys.length < 2) return keys[0];
  const picked = await deps.pick(
    title,
    keys.map((k, i) => ({
      id: String(i),
      label: `${k.to.schema}.${k.to.table} (${k.to.columns.join(", ")})`,
      detail: k.name,
    })),
  );
  return picked === undefined ? undefined : keys[Number(picked)];
}

/** The keys of the result's table that the cursor's column is in. */
async function keysAtCursor(/** @type {Deps} */ deps) {
  const here = onScreen(deps);
  const cursor = cursorOf(deps);
  const keys = await readKeys(deps, here.conn, here.source);
  const column = here.set.columns[cursor.col] ?? "";
  const mine = keys.outgoing.filter((k) => k.from.columns.includes(column));
  if (mine.length === 0)
    throw new Error(
      `${column} is in no foreign key of ${here.source.schema}.${here.source.name}: there is nothing to follow.`,
    );
  return { here, cursor, column, mine };
}

/** Go from the cursor's key cell to the row it points at. */
export async function follow(
  /** @type {Deps} */ deps,
  /** @type {Trail} */ trail,
  /** @type {Record<string, unknown>} */ args,
) {
  const { here, cursor, mine } = await keysAtCursor(deps);
  const key = await oneOf(deps, mine, args.constraint, "Database: follow which key?");
  if (!key) return undefined;
  const made = keyFilters({
    from: key.from.columns,
    onto: key.to.columns,
    columns: here.set.columns,
    row: here.row(cursor.row),
    numeric: here.numeric,
  });
  if ("error" in made) throw new Error(made.error);
  return said(
    deps,
    await go(deps, trail, here.target, () => openFiltered(deps, here.conn, key.to, made.filters)),
  );
}

/** Count each key's rows that point at the row: null where one is not counted. */
async function countAll(
  /** @type {Deps} */ deps,
  /** @type {Connection} */ conn,
  /** @type {(Filter[] | null)[]} */ filtersOf,
  /** @type {Key[]} */ keys,
) {
  const { dialect } = engineOf(conn.engine);
  const asked = keys.flatMap((k, i) => {
    const filters = filtersOf[i];
    if (!filters) return [];
    const from = tableName(conn, k.from.schema, k.from.table);
    return [{ i, sql: countSql(from, whereWith(dialect, "", filters)) }];
  });
  /** @type {(number | null)[]} */
  const counts = keys.map(() => null);
  if (asked.length === 0) return counts;
  const run = await deps.execute(conn, asked.map((a) => a.sql).join(";\n"), { catalog: true });
  asked.forEach(({ i }, at) => {
    const value = run.result.statements[at]?.sets[0]?.rows[0]?.[0];
    counts[i] = value === null || value === undefined ? null : Number(value);
  });
  return counts;
}

const countWords = (/** @type {number | null | undefined} */ n) =>
  n === null || n === undefined ? "not counted" : `${n} row${n === 1 ? "" : "s"}`;

/** List the keys that point at the cursor's row, counted on request, and open one's rows. */
export async function referencing(
  /** @type {Deps} */ deps,
  /** @type {Trail} */ trail,
  /** @type {Record<string, unknown>} */ args,
) {
  const here = onScreen(deps);
  const cursor = cursorOf(deps);
  const { incoming } = await readKeys(deps, here.conn, here.source);
  if (incoming.length === 0)
    throw new Error(`No foreign key points at ${here.source.schema}.${here.source.name}.`);
  const row = here.row(cursor.row);
  const made = incoming.map((k) =>
    keyFilters({
      from: k.to.columns,
      onto: k.from.columns,
      columns: here.set.columns,
      row,
      numeric: here.numeric,
    }),
  );
  const filtersOf = made.map((m) => ("filters" in m ? m.filters : null));
  let counts = args.count === true ? await countAll(deps, here.conn, filtersOf, incoming) : null;
  /** @type {number | undefined} */
  let chosen =
    typeof args.constraint === "string"
      ? incoming.findIndex((k) => k.name === args.constraint)
      : undefined;
  if (chosen === -1)
    throw new Error(`No foreign key ${args.constraint} points at this row's table.`);
  while (chosen === undefined) {
    const items = incoming.map((k, i) => ({
      id: String(i),
      label: `${k.from.schema}.${k.from.table} (${k.from.columns.join(", ")})`,
      detail: counts ? countWords(counts[i]) : k.name,
    }));
    const picked = await deps.pick("Database: open the rows that point at this row", [
      ...(counts ? [] : [{ id: COUNT, label: "Count the rows of each" }]),
      ...items,
    ]);
    if (picked === undefined) return undefined;
    if (picked === COUNT) counts = await countAll(deps, here.conn, filtersOf, incoming);
    else chosen = Number(picked);
  }
  const key = incoming[chosen];
  const filters = filtersOf[chosen];
  const why = made[chosen];
  if (!key || !filters) throw new Error(why && "error" in why ? why.error : "No such key.");
  return said(
    deps,
    await go(deps, trail, here.target, () => openFiltered(deps, here.conn, key.from, filters)),
  );
}

/** Show the place the last key was followed from again, as it was. */
export async function back(/** @type {Deps} */ deps, /** @type {Trail} */ trail) {
  let closed = 0;
  for (let place = trail.pop(); place; place = trail.pop()) {
    if (!deps.consoles.show(place.id)) {
      closed++;
      continue;
    }
    const target = deps.consoles.current();
    const was = place.table;
    const now = target?.table;
    if (was && now && JSON.stringify(placeOf(target).table) !== JSON.stringify(was)) {
      // Its order, sort keys and filters as they were, then its page read again under them.
      Object.assign(now, { order: was.order, sort: was.sort, filters: was.filters });
      const limit = Math.max(1, deps.settings().maxRows);
      const delta = Math.round(was.offset / limit);
      await deps.consoles.page({ where: was.where, ...(delta ? { delta } : {}) });
    }
    deps.view.focus("grid");
    const gone = closed ? ` (${closed} closed view${closed === 1 ? "" : "s"} skipped)` : "";
    return said(deps, `Back to ${target ? nameOf(target) : "where it was"}${gone}.`);
  }
  throw new Error(
    closed
      ? "Nothing to go back to: the views keys were followed from are closed."
      : "Nothing to go back to: follow a key first (g in the grid).",
  );
}
