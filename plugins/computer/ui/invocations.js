// Which invocation a tool call serves. The SDK hands a command's handler its args only, so this
// keeps every cmd.invoked of the plugin's tools in order, by command id, and a handler takes the
// oldest of its id once the event has reached every listener. The id goes with each act, so the
// core holds it as the invoking agent's (ADR 0123); an agent's call without one is refused.

/** @typedef {{ invocationId: string, caller: string }} Invocation */

/**
 * @param {{ onEvent(listener: (event: any) => void): () => void }} bridge
 * @param {string} prefix
 */
export function createInvocations(bridge, prefix) {
  /** @type {Map<string, Invocation[]>} */
  const waiting = new Map();
  bridge.onEvent((event) => {
    if (event.event !== "cmd.invoked" || !event.data.id.startsWith(prefix)) return;
    const queue = waiting.get(event.data.id) ?? [];
    queue.push({ invocationId: event.data.invocationId, caller: event.data.caller });
    waiting.set(event.data.id, queue);
  });
  return {
    /**
     * The invocation of `id` this call serves, or undefined for a request by name (the palette).
     * The SDK runs a handler before the other listeners see the event: wait one turn first.
     * @param {string} id
     * @returns {Promise<Invocation | undefined>}
     */
    async take(id) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const queue = waiting.get(id);
      const next = queue?.shift();
      if (queue && queue.length === 0) waiting.delete(id);
      return next;
    },
  };
}

/** Whether a caller is an agent (`agent:<id>`), whose acts must name their invocation. */
export const isAgent = (/** @type {string | undefined} */ caller) =>
  typeof caller === "string" && caller.startsWith("agent:");

/** An agent's name for people: `agent:eris` is Eris. */
export function agentName(/** @type {string | undefined} */ agent) {
  const id = (agent ?? "").replace(/^agent:/, "");
  if (!id) return "An agent";
  return id === "eris" ? "Eris" : id.charAt(0).toUpperCase() + id.slice(1);
}
