// The local side's one door to the core: agents.* (specs/bridge/v0/agents.schema.json, ADR 0110),
// every call under agents:manage. A refusal is asked for once (perm.request) and the call tried
// again; a desk that looks for no agent programs answers `unsupported`, which the Home shows as the
// local side being unavailable, not as an error.

/** The scope every agents.* call carries. */
export const AGENTS = /** @type {const} */ ({ permission: "agents:manage" });

/**
 * @typedef {import("@endue-ai/bridge").LocalAgent} LocalAgent
 * @typedef {import("@endue-ai/bridge").LocalAgentSession} LocalAgentSession
 * @typedef {import("@endue-ai/bridge").LocalAgentMessage} LocalAgentMessage
 * @typedef {import("@endue-ai/bridge").LocalAgentRun} LocalAgentRun
 * @typedef {import("@endue-ai/bridge").LocalAgentRunData} LocalAgentRunData
 * @typedef {import("@endue-ai/bridge").LocalAgentAccess} LocalAgentAccess
 * @typedef {{ call(method: string, params: unknown): Promise<any>, onEvent(listener: (event: any) => void): () => void }} Bridge
 * @typedef {"unavailable" | "denied" | "missing" | "failed"} LocalProblem
 */

/** A failed agents.* call, said for people, with what kind of failure it was. */
export class LocalError extends Error {
  /** @param {string} message @param {LocalProblem} kind */
  constructor(message, kind) {
    super(message);
    this.name = "LocalError";
    this.kind = kind;
  }
}

/** @param {unknown} error */
export const codeOf = (error) => /** @type {{ code?: string }} */ (error)?.code ?? "error";

/** A bridge error's own words, without the "method: code: " the client puts first. */
export const whyOf = (/** @type {unknown} */ error) =>
  (error instanceof Error ? error.message : String(error)).replace(/^[a-z.]+: [a-z_]+: /, "");

/** @param {unknown} error */
function said(error) {
  const code = codeOf(error);
  if (code === "unsupported")
    return new LocalError("This desk does not look for agent programs.", "unavailable");
  if (code === "permission_denied")
    return new LocalError("Not allowed to see the agent programs on this computer.", "denied");
  if (code === "not_found") return new LocalError(whyOf(error), "missing");
  return new LocalError(whyOf(error) || code, "failed");
}

/** @param {{ bridge: Bridge }} ctx */
export function createLocalApi({ bridge }) {
  /** @type {Promise<boolean> | undefined} */
  let asking;
  let refused = false;

  /** One call; a refusal asks the person once, then tries again. */
  const call = async (/** @type {string} */ method, /** @type {object} */ params = {}) => {
    const request = () => bridge.call(method, { ...params, scope: AGENTS });
    try {
      return await request();
    } catch (error) {
      if (codeOf(error) !== "permission_denied" || refused) throw said(error);
    }
    asking ??= bridge
      .call("perm.request", {
        permission: AGENTS,
        reason: "To show the agent programs on this computer as cards and chat with them",
      })
      .then((/** @type {{ granted?: boolean }} */ decision) => decision.granted === true)
      .catch(() => false)
      .finally(() => {
        asking = undefined;
      });
    if (!(await asking)) {
      refused = true;
      throw said({ code: "permission_denied" });
    }
    try {
      return await request();
    } catch (error) {
      throw said(error);
    }
  };

  return {
    /** The person asked to try again: a refusal may be asked about once more. */
    again() {
      refused = false;
    },
    /** The agents found on this computer. @returns {Promise<LocalAgent[]>} */
    list: async () => (await call("agents.list")).agents,
    /**
     * One agent's sessions, the most recently active first.
     * @param {string} agent @param {{ limit?: number, query?: string }} [options]
     * @returns {Promise<{ sessions: LocalAgentSession[], total: number }>}
     */
    sessions: (agent, options = {}) => call("agents.sessions", { agent, ...options }),
    /**
     * A session's last turns.
     * @param {string} agent @param {string} sessionId
     * @returns {Promise<{ session: LocalAgentSession, messages: LocalAgentMessage[], truncated: boolean }>}
     */
    transcript: (agent, sessionId) => call("agents.transcript", { agent, sessionId, limit: 200 }),
    /**
     * Ask the agent: resumes `sessionId` when given. Resolves with the run as it starts.
     * @param {{ agent: string, prompt: string, sessionId?: string, cwd?: string, access?: LocalAgentAccess, model?: string }} ask
     * @returns {Promise<LocalAgentRun>}
     */
    ask: async (ask) => (await call("agents.ask", ask)).run,
    /** End a run that is going on. @param {string} runId @returns {Promise<LocalAgentRun>} */
    stop: async (runId) => (await call("agents.stop", { runId })).run,
    /** The runs the core keeps, the newest first. @returns {Promise<LocalAgentRun[]>} */
    runs: async () => (await call("agents.runs")).runs,
    /**
     * Hear each step of every run, and every import.
     * @param {(event: { kind: "run", data: LocalAgentRunData } | { kind: "changed", agent: string }) => void} listener
     */
    onEvent: (listener) =>
      bridge.onEvent((/** @type {{ event: string, data: any }} */ event) => {
        if (event.event === "agents.run") listener({ kind: "run", data: event.data });
        else if (event.event === "agents.changed")
          listener({ kind: "changed", agent: event.data.agent });
      }),
  };
}

/** @typedef {ReturnType<typeof createLocalApi>} LocalApi */
