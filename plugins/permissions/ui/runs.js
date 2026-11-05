// The fleet board's actions on agents' runs (ADR 0100): approve or deny the approval a run waits for,
// and stop a run. This plugin holds perm:manage, so it answers with perm.approve and agent.cancel.
// It talks to the bridge only; main.js hands it the SDK's commands.

const MANAGE = { permission: "perm:manage" };
/** The source of the runs the core records itself. */
const CORE_RUNS = "desk.agents";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginCommands} PluginCommands
 * @typedef {import("@endue-ai/plugin-sdk").PluginBridge} PluginBridge
 * @typedef {Record<string, unknown> | undefined} Args
 */

/** The approval id a run's args carry, or an error a person can read. */
function approvalOf(/** @type {Args} */ args) {
  const id = args?.approval;
  if (typeof id !== "string" || id === "")
    throw new Error("Nothing on this run waits for approval.");
  return id;
}

/**
 * Answer `endue.permissions.approve`, `.deny` and `.cancel-run`.
 * @param {{ commands: Pick<PluginCommands, "on">, bridge: Pick<PluginBridge, "call"> }} ctx
 */
export function wireRuns({ commands, bridge }) {
  commands.on("endue.permissions.approve", async (/** @type {Args} */ args) => {
    const answer = args?.answer === "task" ? "task" : "once";
    await bridge.call("perm.approve", { approvalId: approvalOf(args), answer, scope: MANAGE });
    return { approved: true };
  });
  commands.on("endue.permissions.deny", async (/** @type {Args} */ args) => {
    await bridge.call("perm.approve", {
      approvalId: approvalOf(args),
      answer: "deny",
      scope: MANAGE,
    });
    return { denied: true };
  });
  commands.on("endue.permissions.cancel-run", async (/** @type {Args} */ args) => {
    const run = args?.run;
    if (typeof run !== "string" || run === "") throw new Error("Which run? Give its id as run.");
    const source = /** @type {{ connector?: unknown, instance?: unknown } | undefined} */ (
      args?.source
    );
    const other =
      typeof source?.connector === "string" && source.connector !== CORE_RUNS
        ? {
            source: { connector: source.connector, instance: String(source.instance ?? "default") },
          }
        : {};
    return bridge.call("agent.cancel", { runId: run, scope: MANAGE, ...other });
  });
}
