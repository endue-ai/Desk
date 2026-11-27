// What an agent may hand desk.universal (ADR 0367). The plugin runs a view's `command` source as
// itself, under the `cmd:invoke` of `*` it holds from install, and before anyone has said yes, so
// a view an agent or an MCP server passes inline may not take one: it could run any command,
// irreversible ones included, past the approval the agent's own call would wait for. A saved view
// opened by id was made or kept by the person, so it opens as it is. No DOM.

/** @typedef {{ invocationId: string, caller: string }} Invocation */

/** Whether an agent of the brain or an MCP server invoked the command. */
export const byAgent = (/** @type {Invocation | undefined} */ invocation) => {
  const caller = invocation?.caller ?? "";
  return caller.startsWith("agent:") || caller.startsWith("mcp:");
};

/**
 * Throw when `invocation` is an agent's and `view`, passed inline, reads a command source.
 * @param {Invocation | undefined} invocation
 * @param {unknown} view
 */
export function refuseAgentCommandSource(invocation, view) {
  if (!byAgent(invocation) || !view || typeof view !== "object") return;
  const source = /** @type {{ source?: { command?: unknown } }} */ (view).source;
  if (typeof source?.command !== "string") return;
  throw new Error(
    `An agent's view cannot read a command source (${source.command}): propose it with ` +
      "desk.propose, or name a saved view by its id.",
  );
}
