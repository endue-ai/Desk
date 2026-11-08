// The desk commands the plugin leans on: the palette's pick, to ask for a name or confirm what
// cannot be undone, and buffers, so the logs and detail views are in Mod+B and the buffer list.

/**
 * @typedef {{ id: string, label: string, detail?: string }} PickItem
 * @typedef {"logs" | "inspect"} BufferKey
 */

/** @param {import("@endue-ai/plugin-sdk").PluginCommands} commands */
export function createDesk(commands) {
  /** The desk buffer each extra view is, once opened. @type {Map<BufferKey, string>} */
  const buffers = new Map();

  /**
   * Ask the person: one of `items`, or (`free`) any text. Undefined when they cancel; "" when they
   * answer with nothing.
   * @param {string} title
   * @param {PickItem[]} items
   * @param {boolean} [free]
   * @param {string} [placeholder]
   * @returns {Promise<string | undefined>}
   */
  const pick = async (title, items, free = false, placeholder = "") => {
    try {
      const picked = await commands.run("desk.palette.pick", {
        title,
        items,
        ...(free ? { free, placeholder } : {}),
      });
      return typeof picked === "string" ? picked : undefined;
    } catch (error) {
      if (/** @type {{ code?: string }} */ (error)?.code === "cancelled") return undefined;
      throw new Error("Cannot ask: the palette is off.");
    }
  };

  /** Open the view's buffer, or rename it when it is open already. */
  const buffer = async (/** @type {BufferKey} */ key, /** @type {string} */ name) => {
    if (buffers.has(key)) {
      await commands.run("desk.buffers.update", { id: buffers.get(key), name }).catch(() => {});
      return;
    }
    const id = await commands.run("desk.buffers.open", { name }).catch(() => undefined);
    if (typeof id === "string") buffers.set(key, id);
  };

  /** Which of this plugin's views a desk request's buffer id names. */
  const viewOf = (/** @type {unknown} */ args) => {
    const id = /** @type {{ buffer?: string } | undefined} */ (args)?.buffer;
    return [...buffers].find(([, value]) => value === id)?.[0];
  };

  return { pick, buffer, buffers, viewOf };
}

/**
 * Wrap what the view's keys run: a failure is said, never thrown at the DOM, and a cancel is quiet.
 * @param {(text: string) => void} say
 * @param {() => void} succeeded Called when the action worked, so the next failure is said again.
 */
export function guarded(say, succeeded) {
  return (/** @type {(...args: any[]) => unknown} */ fn) =>
    async (/** @type {unknown[]} */ ...args) => {
      try {
        await fn(...args);
        succeeded();
      } catch (error) {
        if (/** @type {{ code?: string }} */ (error)?.code === "cancelled") return;
        say(error instanceof Error ? error.message : String(error));
      }
    };
}
