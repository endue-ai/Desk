// Editing a foreign key's cell by picking the row it points at (PG-41, ADR 0322): the palette lists
// the referenced table's rows by key, 50 at a time with its readable column; More rows fetches the
// next page, typed text that is no listed row searches the key and the readable column on the
// server, and a key of one column can take the typed text as it is. The pick sets every column of
// the key in the cursor's row as one pending, undoable step; nothing runs until Submit. No DOM.

import { editCell } from "../../edit/pending.js";
import { engineOf } from "../../engines/index.js";
import { PAGE, readableColumn, searchSql } from "../../links/model.js";
import { cursorOf, onScreen, readKeys } from "./read.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("../../links/model.js").Key} Key
 */

const ROW = "\u0000row:";
const MORE = "\u0000more";
const TYPED = "\u0000typed";
/** Rounds of the palette one edit may take: pages and searches. */
const ROUNDS = 100;

/** One page of the referenced rows: the key's values and the readable one's, and whether more follow. */
async function pageOf(
  /** @type {Deps} */ deps,
  /** @type {Connection} */ conn,
  /** @type {Key} */ key,
  /** @type {string} */ readable,
  /** @type {string} */ text,
  /** @type {number} */ offset,
) {
  const { dialect } = engineOf(conn.engine);
  const sql = searchSql(dialect, {
    schema: key.to.schema,
    table: key.to.table,
    key: key.to.columns,
    readable,
    text,
    offset,
  });
  const run = await deps.execute(conn, sql, { catalog: true, maxRows: PAGE + 1 });
  const error = run.result.error ?? run.result.statements[0]?.error;
  if (error) throw new Error(error.message);
  const rows = run.result.statements[0]?.sets[0]?.rows ?? [];
  return { rows: rows.slice(0, PAGE), more: rows.length > PAGE };
}

const shown = (/** @type {string | null | undefined} */ v) => v ?? "NULL";

/** Pick the row the cursor's key cell points at, and set the key to it. */
export async function pickKey(
  /** @type {Deps} */ deps,
  /** @type {Record<string, unknown>} */ args,
) {
  const here = onScreen(deps);
  const cursor = cursorOf(deps);
  const { state } = await deps.consoles.edits.ready();
  const column = here.set.columns[cursor.col] ?? "";
  const keys = (await readKeys(deps, here.conn, here.source)).outgoing.filter((k) =>
    k.from.columns.includes(column),
  );
  const key = keys[0];
  if (!key) throw new Error(`${column} is in no foreign key: type its value instead.`);
  const cols = key.from.columns.map((name) => here.set.columns.indexOf(name));
  const lacking = key.from.columns.filter((_, i) => (cols[i] ?? -1) < 0);
  if (lacking.length)
    throw new Error(`${lacking.join(", ")} is not in this result: the key is set as a whole.`);
  const fixed = cols.map((c) => state.target.columns[c]?.editor?.fixed).find(Boolean);
  if (fixed) throw new Error(fixed);
  const tableColumns = await deps.catalog.columns(here.conn, key.to.schema, key.to.table);
  const readable = readableColumn(tableColumns, key.to.columns);
  const where = `${key.to.schema}.${key.to.table}`;
  const by = [...key.to.columns, readable].filter(Boolean).join(" or ");
  let text = typeof args.text === "string" ? args.text : "";
  let offset = 0;
  for (let round = 0; round < ROUNDS; round++) {
    const page = await pageOf(deps, here.conn, key, readable, text, offset);
    const width = key.to.columns.length;
    const items = page.rows.map((row, i) => ({
      id: `${ROW}${i}`,
      label: row.map(shown).join(" · "),
    }));
    if (page.more) items.push({ id: MORE, label: `More rows (from ${offset + PAGE + 1})` });
    if (text && cols.length === 1) items.push({ id: TYPED, label: `Use “${text}” as it is` });
    const holding = text ? ` Holding “${text}”${page.rows.length ? "" : ": no row does"}` : "";
    const title = `Database: ${key.from.columns.join(", ")} is which row of ${where}?${holding}`;
    const picked = await deps.pick(title, items, true, `Search by ${by}`);
    if (picked === undefined) return undefined;
    if (picked === MORE) {
      offset += PAGE;
      continue;
    }
    if (picked === TYPED) return setKey(deps, state, cursor.row, cols, key, [text], "");
    if (picked.startsWith(ROW)) {
      const row = page.rows[Number(picked.slice(ROW.length))] ?? [];
      const label = readable ? shown(row[width]) : "";
      return setKey(deps, state, cursor.row, cols, key, row.slice(0, width), label);
    }
    text = picked;
    offset = 0;
  }
  return undefined;
}

/** Set the key's columns in a row to a referenced row's values, as one step. */
function setKey(
  /** @type {Deps} */ deps,
  /** @type {import("../../edits.js").EditState} */ state,
  /** @type {number} */ row,
  /** @type {number[]} */ cols,
  /** @type {Key} */ key,
  /** @type {(string | null)[]} */ values,
  /** @type {string} */ label,
) {
  deps.consoles.edits.step(state, (changes, target, set) => {
    cols.forEach((c, i) => {
      editCell(changes, target, set, row, c, values[i] ?? null);
    });
  });
  const what = label ? ` (${label})` : "";
  const words = `${key.from.columns.join(", ")} = ${values.map(shown).join(", ")}${what}: pending until Submit.`;
  deps.say(words);
  return words;
}
