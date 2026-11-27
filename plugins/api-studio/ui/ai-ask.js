// AI through the desk's brain (brain.ask, under brain:ask): each question goes with a tool whose
// arguments are the answer, so nothing is read out of prose. The answer arrives as brain.turn
// events for this plugin only; a turn that answers before its id came back is kept until it does.

export const SCOPE = Object.freeze({ permission: "brain:ask" });
const PROMPT_MAX = 30_000;
const WAIT_MS = 120_000;

/** Cut `text` to `max` characters, saying so at the cut. */
export function clip(/** @type {string} */ text, max = 12_000) {
  return text.length <= max
    ? text
    : `${text.slice(0, max)}\n… (${text.length - max} more characters cut)`;
}

/**
 * @typedef {{ name: string, description: string, schema: Record<string, unknown> }} Tool
 * @param {{ call(method: string, params: any): Promise<any>, onEvent(fn: (e: any) => void): unknown }} bridge
 */
export function createAsker(bridge) {
  /** @type {Map<string, { resolve(v: any): void, reject(e: Error): void, timer: ReturnType<typeof setTimeout> }>} */
  const waiting = new Map();
  /** @type {Map<string, any>} */
  const early = new Map();

  const settle = (/** @type {any} */ data) => {
    const turn = waiting.get(data.turnId);
    if (!turn) return false;
    if (data.kind === "completed") turn.resolve(data.structured ?? null);
    else if (data.kind === "error" || data.kind === "offline")
      turn.reject(
        new Error(
          data.text ||
            (data.kind === "offline" ? "The brain is offline." : "The brain could not answer."),
        ),
      );
    else return true;
    clearTimeout(turn.timer);
    waiting.delete(data.turnId);
    return true;
  };

  bridge.onEvent((event) => {
    if (event.event !== "brain.turn") return;
    const data = event.data;
    if (!settle(data) && ["completed", "error", "offline"].includes(data.kind))
      early.set(data.turnId, data);
  });

  /**
   * Ask once; resolves with the tool's arguments, or null when the brain answered in words only.
   * @param {string} prompt @param {Tool} tool @returns {Promise<any>}
   */
  async function ask(prompt, tool) {
    let turnId;
    try {
      ({ turnId } = await bridge.call("brain.ask", {
        prompt: prompt.slice(0, PROMPT_MAX),
        tool,
        scope: { ...SCOPE },
      }));
    } catch (error) {
      const code = /** @type {any} */ (error)?.code;
      if (code === "permission_denied")
        throw new Error("API Studio may not ask the brain: allow it in the plugin's permissions.");
      if (code === "unsupported") throw new Error("This desk has no brain to ask.");
      throw new Error(`Could not ask the brain: ${code ?? "error"}.`);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.delete(turnId);
        reject(new Error("The brain took too long to answer."));
      }, WAIT_MS);
      waiting.set(turnId, { resolve, reject, timer });
      const kept = early.get(turnId);
      if (kept) {
        early.delete(turnId);
        settle(kept);
      }
    });
  }
  return { ask };
}

/** @typedef {ReturnType<typeof createAsker>} Asker */
