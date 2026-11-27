import { t } from "./strings/index.js";
// The features' panels as desk buffers (feature-host.js): one buffer per type and name, opened
// again with its new state when it is there, given a new state in place, and kept for a restart
// when its type's keep says what of its state to keep. The surface state then holds the panel's
// type, connection, name and kept state, and the panel opens again with it (on screen when it was,
// behind the buffer on screen otherwise). A panel's state sits under its type in the buffer
// (`model.diagram`), as a table's page sits under `model.table`. No DOM.

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {import("./consoles.js").Console} Console
 * @typedef {{ type: string, connection: string, name: string, state: unknown, shown?: true }} Kept
 */

/**
 * @param {ReturnType<typeof import("./buffers.js").createBuffers>} buffers
 * @param {{
 *   connection(id: string): Connection | undefined,
 *   panels?: Record<string, Pick<import("./feature-host.js").Panel, "keep">>,
 * }} deps
 */
export function createPanels(buffers, deps) {
  const types = deps.panels ?? {};
  const isPanel = (/** @type {string} */ kind) => Object.hasOwn(types, kind);

  /**
   * @param {Connection | null} conn
   * @param {string} type
   * @param {string} name
   * @param {unknown} state
   * @param {boolean} [shown]
   */
  const open = async (conn, type, name, state, shown = true) => {
    if (!isPanel(type)) throw new Error(t("panels.noFeatureDrawsAPanel", { type: String(type) }));
    const found = buffers.find((b) => b.kind === type && b.name === name);
    if (found) {
      found[type] = state;
      return shown ? buffers.show(found) : found;
    }
    const id = await buffers.open(name);
    const target = buffers.made({
      id,
      kind: type,
      connection: conn?.id ?? "",
      name,
      [type]: state,
    });
    return shown ? buffers.show(target) : buffers.add(target);
  };

  return {
    /** Show a panel of a connection (or of none), opening its buffer the first time. */
    openPanel: (
      /** @type {Connection | null} */ conn,
      /** @type {string} */ type,
      /** @type {string} */ name,
      /** @type {unknown} */ state,
    ) => open(conn, type, name, state),
    /** Give a panel its next state; drawn at once when it is on screen. */
    updatePanel(/** @type {string} */ id, /** @type {unknown} */ state) {
      const target = buffers.get(id);
      if (!target || !isPanel(target.kind)) return false;
      target[target.kind] = state;
      if (buffers.current() === target) buffers.render();
      else buffers.changed();
      return true;
    },
    /** What comes back after a restart: each panel whose type keeps something of its state. */
    kept() {
      const shown = buffers.current();
      return buffers.list().flatMap((b) => {
        const value = isPanel(b.kind) ? types[b.kind]?.keep?.(b[b.kind]) : undefined;
        if (value === undefined) return [];
        /** @type {Kept} */
        const kept = { type: b.kind, connection: b.connection, name: b.name, state: value };
        return [b === shown ? { ...kept, shown: true } : kept];
      });
    },
    /** Open the panels kept before a restart, the one that was on screen last. */
    async restore(/** @type {unknown} */ saved) {
      if (!Array.isArray(saved)) return;
      const valid = /** @type {Kept[]} */ (saved).filter(
        (k) => k && isPanel(k.type) && typeof k.name === "string",
      );
      const ordered = [...valid.filter((k) => !k.shown), ...valid.filter((k) => k.shown)];
      for (const k of ordered) {
        const conn = k.connection ? deps.connection(k.connection) : null;
        if (conn !== undefined) await open(conn, k.type, k.name, k.state, k.shown === true);
      }
    },
  };
}
