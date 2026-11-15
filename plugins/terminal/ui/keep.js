// What the terminal keeps of its tabs across a restart (issue 315, ADR 0249), in its own store key
// `layout`: each tab's split layout with every pane's folder, title and whether a person named it,
// the pane in use per tab and the tab on screen, by position. The processes do not outlive the app,
// so no ids are kept: after a restart each pane starts a fresh shell in its folder. No DOM.
import { panesOf, SPLITS } from "./layout.js";
import { snapshotOf } from "./snapshot.js";

/**
 * @typedef {import("./layout.js").Layout} Layout
 * @typedef {{ cwd: string | null, title: string, named: boolean }} KeptPane
 * @typedef {{ pane: KeptPane } | { split: "right" | "down", ratio: number, a: KeptNode, b: KeptNode }} KeptNode
 * @typedef {{ focused: number, layout: KeptNode }} KeptTab
 * @typedef {{ v: 1, shown: number | null, tabs: KeptTab[] }} Kept
 * @typedef {import("./types.js").Session} Session
 * @typedef {ReturnType<typeof import("./panes.js").createTabSet>} TabSet
 */

/** The store key the layout is kept under. */
export const KEY = "layout";

/**
 * What to keep of `tabs` (in order, `shown` the index of the one on screen), `info` saying each
 * pane's folder and title.
 * @param {Array<{ layout: Layout, focused: string }>} tabs
 * @param {number | null} shown
 * @param {(id: string) => KeptPane} info
 * @returns {Kept}
 */
export function keptOf(tabs, shown, info) {
  /** @returns {KeptNode} */
  const node = (/** @type {Layout} */ n) =>
    "pane" in n
      ? { pane: info(n.pane) }
      : { split: n.split, ratio: n.ratio, a: node(n.a), b: node(n.b) };
  return {
    v: 1,
    shown,
    tabs: tabs.map(({ layout, focused }) => ({
      focused: Math.max(0, panesOf(layout).indexOf(focused)),
      layout: node(layout),
    })),
  };
}

const isObject = (/** @type {unknown} */ value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A kept node, or null when it is not one. @returns {KeptNode | null} */
function nodeOf(/** @type {unknown} */ value, depth = 0) {
  if (!isObject(value) || depth > 32) return null;
  const v = /** @type {Record<string, unknown>} */ (value);
  if (isObject(v.pane)) {
    const p = /** @type {Record<string, unknown>} */ (v.pane);
    if (p.cwd !== null && typeof p.cwd !== "string") return null;
    if (typeof p.title !== "string" || typeof p.named !== "boolean") return null;
    return { pane: { cwd: p.cwd, title: p.title, named: p.named } };
  }
  const split = SPLITS.find((s) => s === v.split);
  if (!split || typeof v.ratio !== "number" || !(v.ratio > 0 && v.ratio < 1)) return null;
  const a = nodeOf(v.a, depth + 1);
  const b = nodeOf(v.b, depth + 1);
  return a && b ? { split, ratio: v.ratio, a, b } : null;
}

const count = (/** @type {KeptNode} */ n) => ("pane" in n ? 1 : count(n.a) + count(n.b));

/** What the store held, read back; null when it is not a layout this version keeps. */
export function readKept(/** @type {unknown} */ value) {
  if (!isObject(value)) return null;
  const v = /** @type {Record<string, unknown>} */ (value);
  if (v.v !== 1 || !Array.isArray(v.tabs) || v.tabs.length === 0) return null;
  /** @type {KeptTab[]} */
  const tabs = [];
  for (const tab of v.tabs) {
    if (!isObject(tab)) return null;
    const layout = nodeOf(tab.layout);
    const { focused } = /** @type {{ focused?: unknown }} */ (tab);
    if (!layout || !Number.isInteger(focused)) return null;
    if (/** @type {number} */ (focused) < 0 || /** @type {number} */ (focused) >= count(layout))
      return null;
    tabs.push({ focused: /** @type {number} */ (focused), layout });
  }
  const shown =
    Number.isInteger(v.shown) &&
    /** @type {number} */ (v.shown) >= 0 &&
    /** @type {number} */ (v.shown) < tabs.length
      ? /** @type {number} */ (v.shown)
      : null;
  return /** @type {Kept} */ ({ v: 1, shown, tabs });
}

/** Where a pane's shell is, or was started: what a split and a restart start in. */
export const whereOf = (/** @type {Session} */ s) =>
  s.cwd ?? s.program?.cwd ?? s.programs[0]?.cwd ?? null;

/**
 * Writes what is kept: the reload snapshot with ctx.state each time, the layout with store.set
 * only when it changed.
 * @param {{ state: { set(value: unknown): void }, bridge: { call(method: "store.set", params: { key: string, value: unknown }): Promise<unknown> } }} deps
 */
export function createKeeper({ state, bridge }) {
  let stored = "";
  return {
    /**
     * @param {number} next
     * @param {string | null} shown
     * @param {TabSet} tabset
     * @param {(id: string) => Session} held
     */
    write(next, shown, tabset, held) {
      const tabs = tabset.all();
      state.set(snapshotOf(next, shown, tabset.panes().map(held), tabs));
      // Every terminal closed: nothing comes back, the next start opens one terminal.
      const at = tabs.findIndex((tab) => shown !== null && tab.id === tabset.tabOf(shown)?.id);
      const value =
        tabs.length === 0
          ? null
          : keptOf(tabs, at < 0 ? null : at, (id) => {
              const s = held(id);
              return { cwd: whereOf(s), title: s.title, named: s.named };
            });
      const text = JSON.stringify(value);
      if (text === stored) return;
      stored = text;
      bridge.call("store.set", { key: KEY, value }).catch(() => {});
    },
  };
}
