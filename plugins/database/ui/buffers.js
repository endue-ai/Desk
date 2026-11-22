// The plugin's desk buffers: its consoles, table views, DDL views and the features' panels, which
// of them is on screen (and when each was last), and the desk's side of each (opened under a name,
// shown, closed, closed with its connection). Every change draws the buffer on screen and tells the
// controller, which keeps what comes back after a restart. A buffer drawn is decorated first (its
// PostgreSQL session's state, PG-02), and one that goes is told (its session closes). No DOM.

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {import("./consoles.js").Console} Console
 * @typedef {{
 *   commands: { run(id: string, args?: unknown): Promise<unknown> },
 *   connection(id: string): Connection | undefined,
 *   settings(): import("./settings.js").Settings,
 *   view: { console(model: Console | null, conn: Connection | null): void, closed?(id: string): void },
 *   changed(): void,
 *   decorate?(model: Console, conn: Connection | null): void,
 *   gone?(target: Console): void,
 * }} Deps
 */

/** @param {Deps} deps */
export function createBuffers(deps) {
  /** @type {Map<string, Console>} */
  const all = new Map();
  /** @type {string | null} */
  let current = null;
  let local = 0;
  /** Counts each show, so a buffer knows when it was on screen last (`used`). */
  let tick = 0;

  const shown = () => (current ? (all.get(current) ?? null) : null);
  const render = () => {
    const model = shown();
    const conn = model ? (deps.connection(model.connection) ?? null) : null;
    if (model) deps.decorate?.(model, conn);
    deps.view.console(model, conn);
    deps.changed();
  };
  /** The buffer is gone: it leaves the list, the screen and what the view keeps for it. */
  const forget = (/** @type {string} */ id) => {
    const target = all.get(id);
    if (!target || !all.delete(id)) return false;
    if (current === id) current = null;
    deps.view.closed?.(id);
    deps.gone?.(target);
    return true;
  };

  return {
    render,
    changed: () => deps.changed(),
    /** The desk buffer for a name, or a local id when the desk has no buffers. */
    async open(/** @type {string} */ name) {
      const id = await deps.commands.run("desk.buffers.open", { name }).catch(() => undefined);
      return typeof id === "string" ? id : `local-${++local}`;
    },
    /** @returns {Console} */
    made: (
      /** @type {Partial<Console> & Pick<Console, "id" | "kind" | "connection" | "name">} */ fields,
    ) => ({
      text: "",
      table: null,
      execution: null,
      shown: null,
      running: false,
      tab: 0,
      maxRows: deps.settings().maxRows,
      edit: null,
      page: null,
      ...fields,
    }),
    /** Put a buffer on screen, adding it the first time. */
    show(/** @type {Console} */ target) {
      all.set(target.id, target);
      current = target.id;
      target.used = ++tick;
      render();
      return target;
    },
    /** Add a buffer without showing it (one that comes back after a restart). */
    add(/** @type {Console} */ target) {
      all.set(target.id, target);
      return target;
    },
    get: (/** @type {string} */ id) => all.get(id),
    find: (/** @type {(c: Console) => boolean} */ test) => [...all.values()].find(test),
    current: shown,
    list: () => [...all.values()],
    /** The desk shows one of this plugin's buffers. */
    showId(/** @type {string} */ id) {
      const target = all.get(id);
      if (!target) return false;
      current = id;
      target.used = ++tick;
      render();
      return true;
    },
    /** The desk closed one of this plugin's buffers. */
    closed(/** @type {string} */ id) {
      if (forget(id)) render();
    },
    /** Close every buffer of a connection (it was removed). */
    async drop(/** @type {string} */ connection) {
      for (const target of [...all.values()].filter((c) => c.connection === connection)) {
        forget(target.id);
        await deps.commands.run("desk.buffers.close", { id: target.id }).catch(() => {});
      }
      render();
    },
  };
}
