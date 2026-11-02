// desk.views.preview { view, note? }: a proposed view, one no file holds yet, drawn over live data in
// a floating card with Apply, Try again and Discard (ADR 0073). The command answers with the person's
// choice, as desk.palette.pick answers with what was picked: { choice: "apply" }, { choice: "retry",
// correction? } or { choice: "discard" }. Escape, closing, or anything opened over it is Discard; so
// is a newer preview for an older one. Apply and Try again leave the preview on screen until the desk
// opens what comes next.

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("./engine.js").Engine} Engine
 * @typedef {{ choice: "apply" } | { choice: "retry", correction?: string } | { choice: "discard" }} Choice
 * @typedef {{ choose(choice: string, correction?: string): void }} Preview
 */

const DISCARD = /** @type {Choice} */ ({ choice: "discard" });

/**
 * @param {PluginContext} ctx
 * @param {Engine} engine
 * @returns {Preview}
 */
export function createPreview(ctx, engine) {
  /** The preview waiting for the person: who opened it, and how to answer. */
  /** @type {{ token: object, resolve(choice: Choice): void } | null} */
  let waiting = null;
  const settle = (/** @type {Choice} */ choice) => {
    const was = waiting;
    waiting = null;
    was?.resolve(choice);
  };
  engine.onLeave((left) => {
    if (waiting && left?.owner === waiting.token) settle(DISCARD);
  });

  ctx.commands.on("desk.views.preview", async (args) => {
    const { view, note = "" } = /** @type {{ view?: unknown, note?: unknown }} */ (args ?? {});
    const id = /** @type {{ id?: unknown } | null} */ (view)?.id;
    if (typeof view !== "object" || view === null || typeof id !== "string")
      throw new Error("desk.views.preview needs a view.");
    settle(DISCARD);
    const token = {};
    /** @type {Promise<Choice>} */
    const answer = new Promise((resolve) => {
      waiting = { token, resolve };
    });
    const mine = () => waiting?.token === token;
    try {
      const shown = await engine.open({ view, preview: { note: String(note) }, owner: token });
      // Something else was opened before this preview showed: it never will.
      if (/** @type {{ replaced?: boolean }} */ (shown).replaced && mine()) settle(DISCARD);
    } catch (error) {
      if (mine()) waiting = null;
      throw error;
    }
    return answer;
  });

  return {
    choose(choice, correction) {
      if (!waiting) return;
      const text = typeof correction === "string" ? correction.trim() : "";
      if (choice === "apply") settle({ choice: "apply" });
      else if (choice === "retry")
        settle({ choice: "retry", ...(text ? { correction: text } : {}) });
      else {
        settle(DISCARD);
        engine.close();
      }
    },
  };
}
