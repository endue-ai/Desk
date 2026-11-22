// Pinned result tabs (PG-26, ADR 0329): a console's result kept through its later runs as a tab of
// kind `pinned` after the run's tabs (tabs.js), named after its statement and the time it ran, with
// the primary key the catalog named for it. The pinned tabs of every console count against one
// memory limit, each result by its estimated size in the frame (two bytes a character and an
// overhead a cell and a row); a pin past the limit lets go of the oldest first. No DOM.

/**
 * @typedef {import("../engines/common.js").ResultSet} ResultSet
 * @typedef {import("../tabs.js").Tab} Tab
 * @typedef {import("../consoles.js").Console} Console
 * @typedef {{ id: string, n: number, sql: string, at: number, bytes: number, key: string[] }} Pin
 *   `n` orders pins by when they were made; `at` is when the result ran; `key` its primary key.
 */

export const PIN_LIMIT = 64 * 1024 * 1024;
const LABEL = 24;
let made = 0;

/** About how much of the frame's memory a result holds. */
export function sizeOf(/** @type {Pick<ResultSet, "rows">} */ set) {
  let bytes = 64;
  for (const row of set.rows) {
    bytes += 32;
    for (const value of row)
      bytes += value === null || value === undefined ? 8 : 16 + value.length * 2;
  }
  return bytes;
}

/** A time of day as the label shows it. */
export const clock = (/** @type {number} */ at) => new Date(at).toTimeString().slice(0, 8);

/** A pinned tab's name: its statement on one line, cut, and the time it ran. */
export function pinLabel(/** @type {string} */ sql, /** @type {number} */ at) {
  const line = sql.replace(/\s+/gu, " ").trim().replace(/;$/u, "");
  const cut = line.length > LABEL ? `${line.slice(0, LABEL - 1).trimEnd()}…` : line;
  return `${cut} · ${clock(at)}`;
}

/**
 * A pinned tab of a result set.
 * @param {ResultSet} set
 * @param {{ sql: string, at: number, key: string[] }} of
 * @returns {Tab}
 */
export function pinnedTab(set, { sql, at, key }) {
  const n = ++made;
  /** @type {Pin} */
  const pin = { id: `pin-${n}`, n, sql, at, bytes: sizeOf(set), key };
  return { label: pinLabel(sql, at), kind: "pinned", set, statement: -1, pin };
}

/**
 * The pinned tabs to let go of, oldest first, so that `adding` more bytes keep under `limit`;
 * null when `adding` alone is past it.
 * @param {Tab[]} pinned
 * @param {number} adding
 * @param {number} limit
 */
export function toLetGo(pinned, adding, limit) {
  if (adding > limit) return null;
  const oldest = [...pinned].sort((a, b) => (a.pin?.n ?? 0) - (b.pin?.n ?? 0));
  let total = oldest.reduce((sum, tab) => sum + (tab.pin?.bytes ?? 0), adding);
  /** @type {Tab[]} */
  const gone = [];
  for (const tab of oldest) {
    if (total <= limit) break;
    gone.push(tab);
    total -= tab.pin?.bytes ?? 0;
  }
  return gone;
}

/** Take a pinned tab out of its console, the tab on screen moving back when it was that one. */
export function unpinFrom(/** @type {Console} */ target, /** @type {Tab} */ tab) {
  target.pinned = /** @type {Tab[]} */ (target.pinned ?? []).filter((t) => t !== tab);
  const tabs = target.shown?.tabs;
  const at = tabs ? tabs.indexOf(tab) : -1;
  if (!tabs || at < 0) return;
  tabs.splice(at, 1);
  if (target.tab >= at) target.tab = Math.max(0, target.tab - 1);
}
