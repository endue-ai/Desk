// Every run goes to the desk's agent registry (ADR 0100) when it starts and when it ends, so the fleet
// board shows who works on what; `agent.cancelled` from the desk stops the run. The agent is the
// program (claude, codex), which the registry lists as endue.local-agents/<id>.

/** A run's ending, as a run state of specs/item/v0. */
const STATES = Object.freeze({
  running: "running",
  done: "done",
  failed: "failed",
  stopped: "cancelled",
});

/** `text` cut to `max` characters. */
const clip = (/** @type {string} */ text, /** @type {number} */ max) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/**
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call" | "onEvent">} bridge
 */
export function createReports(bridge) {
  /** The state last reported, by run id. @type {Map<string, string>} */
  const sent = new Map();
  return {
    /**
     * Report `run` when its state changed since the last report.
     * @param {import("./runs.js").Run} run
     */
    report(run) {
      const state = STATES[run.ending] ?? "failed";
      if (sent.get(run.id) === state) return;
      sent.set(run.id, state);
      const said = (run.error || run.answer).trim();
      const params = {
        id: run.id,
        agent: { id: run.agent, name: run.name, brain: run.agent },
        title: clip(run.prompt.trim() || run.name, 200),
        state,
        startedAt: new Date(run.started).toISOString(),
        ...(run.ended ? { endedAt: new Date(run.ended).toISOString() } : {}),
        ...(state !== "running" && said ? { result: clip(said, 500) } : {}),
      };
      void bridge.call("agent.report", params).catch(() => {});
    },
    /**
     * Stop a run when the desk asks (agent.cancelled).
     * @param {(runId: string) => unknown} stop
     */
    onCancelled(stop) {
      bridge.onEvent((event) => {
        if (event.event === "agent.cancelled") stop(event.data.runId);
      });
    },
  };
}
