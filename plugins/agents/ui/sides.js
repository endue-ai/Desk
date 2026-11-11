// The two sources, without a DOM: reading them (the endue agents and their conversations through
// studio.*, the local agents with their sessions and runs through agents.*), what the Home says
// while one is loading, signed out, unavailable, offline, refused or failed, and the runs folded
// from each agents.run step as the core keeps them.

/** How many sessions of each local agent the board and Studio read. */
export const SESSIONS = 20;
const SIDE_STATES = ["signed-out", "unavailable", "offline", "forbidden", "denied"];

/**
 * Read the sources into `sides`, which they change in place, and draw after each read.
 * @param {{ local: import("./local-api.js").LocalApi, studio: import("./studio-api.js").StudioApi, sides: Sides, draw: () => void }} deps
 */
export function createReaders({ local, studio, sides, draw }) {
  const why = (/** @type {unknown} */ error) =>
    error instanceof Error ? error.message : String(error);
  /** @returns {SideState} */
  const stateOf = (/** @type {unknown} */ error) => {
    const kind = /** @type {{ kind?: string }} */ (error).kind ?? "";
    return /** @type {SideState} */ (SIDE_STATES.includes(kind) ? kind : "error");
  };
  return {
    /**
     * Every local agent, its newest sessions and the core's runs: one read, so an "Allow once"
     * shows the agents (the list asks first) and is not asked for again by the calls after it.
     */
    async readLocal() {
      try {
        const { agents, runs, read } = await local.read(async () => {
          const agents = await local.list();
          const [runs, read] = await Promise.all([
            local.runs().catch(() => []),
            Promise.all(
              agents.map((a) =>
                local
                  .sessions(a.id, { limit: SESSIONS })
                  .catch(() => ({ sessions: [], total: a.sessions })),
              ),
            ),
          ]);
          return { agents, runs, read };
        });
        sides.local = {
          state: "ready",
          agents,
          runs,
          sessions: Object.fromEntries(agents.map((a, i) => [a.id, read[i]?.sessions ?? []])),
          totals: Object.fromEntries(agents.map((a, i) => [a.id, read[i]?.total ?? a.sessions])),
        };
      } catch (error) {
        sides.local = { ...sides.local, state: stateOf(error), error: why(error) };
      }
      draw();
    },
    /** One local agent's sessions again: a run ended, or an import changed them. */
    async readSessions(/** @type {string} */ agent) {
      try {
        const { sessions, total } = await local.sessions(agent, { limit: SESSIONS });
        sides.local.sessions = { ...sides.local.sessions, [agent]: sessions };
        sides.local.totals = { ...sides.local.totals, [agent]: total };
        sides.local.agents = await local.list();
      } catch {
        // The list stays as it was; the next event or Refresh reads it again.
      }
      draw();
    },
    /** The person's endue agents and their latest conversations. */
    async readEndue() {
      try {
        const [agents, conversations] = await Promise.all([
          studio.agents(),
          studio.conversations().catch(() => []),
        ]);
        sides.endue = { state: "ready", agents, conversations };
      } catch (error) {
        sides.endue = { state: stateOf(error), agents: [], conversations: [], error: why(error) };
      }
      draw();
    },
  };
}

/**
 * @typedef {import("./studio-api.js").EndueAgent} EndueAgent
 * @typedef {import("./studio-api.js").EndueConversation} EndueConversation
 * @typedef {import("./local-api.js").LocalAgent} LocalAgent
 * @typedef {import("./local-api.js").LocalAgentRun} LocalAgentRun
 * @typedef {import("./local-api.js").LocalAgentRunData} LocalAgentRunData
 * @typedef {import("./local-api.js").LocalAgentSession} LocalAgentSession
 * @typedef {"loading" | "ready" | "signed-out" | "unavailable" | "offline" | "forbidden" | "denied" | "error"} SideState
 * @typedef {object} Sides
 * @property {{ state: SideState, agents: EndueAgent[], conversations: EndueConversation[], error?: string }} endue
 * @property {{ state: SideState, agents: LocalAgent[], runs: LocalAgentRun[], sessions: Record<string, LocalAgentSession[]>, totals: Record<string, number>, error?: string }} local
 * @typedef {{ state: SideState, text: string, action?: "sign-in" | "retry" }} SideNote
 */

/** The longest answer a run keeps, and the most runs, as the core keeps them. */
const TEXT_MAX = 8000;
const RUNS_MAX = 50;

/**
 * The runs after one step: a step that carries its run (its start and its end) replaces it; a text
 * step adds a block to its answer, a tool step counts a tool. A step of a run not known yet waits
 * for the start that brings it.
 * @param {LocalAgentRun[]} runs
 * @param {LocalAgentRunData} data
 */
export function foldRun(runs, data) {
  const at = runs.findIndex((r) => r.runId === data.runId);
  if (data.run) {
    const run = data.run;
    return at < 0 ? [run, ...runs].slice(0, RUNS_MAX) : runs.map((r, i) => (i === at ? run : r));
  }
  const known = runs[at];
  if (!known) return runs;
  /** @type {LocalAgentRun} */
  let next = { ...known, ...(data.sessionId ? { sessionId: data.sessionId } : {}) };
  if (data.kind === "text" && data.text) {
    const text = next.text ? `${next.text}\n\n${data.text}` : data.text;
    next = { ...next, text: text.slice(0, TEXT_MAX) };
  }
  if (data.kind === "tool") next = { ...next, tools: next.tools + 1 };
  return runs.map((r, i) => (i === at ? next : r));
}

/** What the Home says about each source, when it has something to say. */
export function sidesOf(/** @type {Sides} */ sides) {
  return {
    endue: endueNote(sides.endue),
    local: localNote(sides.local),
  };
}

/** @returns {SideNote} */
function endueNote(/** @type {Sides["endue"]} */ side) {
  switch (side.state) {
    case "loading":
      return { state: side.state, text: "Reading your endue agents…" };
    case "signed-out":
      return { state: side.state, text: "Sign in to see your endue agents.", action: "sign-in" };
    case "unavailable":
      return { state: side.state, text: "This desk does not reach endue agents yet." };
    case "offline":
      return {
        state: side.state,
        text: `endue AI is out of reach: ${side.error} Your local agents still work.`,
        action: "retry",
      };
    case "forbidden":
      return { state: side.state, text: `endue AI refused: ${side.error}`, action: "retry" };
    case "denied":
      return {
        state: side.state,
        text: "Not allowed to manage your endue agents.",
        action: "retry",
      };
    case "error":
      return {
        state: side.state,
        text: `Your endue agents could not be read: ${side.error}`,
        action: "retry",
      };
    default:
      return side.agents.length
        ? { state: side.state, text: "" }
        : {
            state: side.state,
            text: "You have no endue agents yet. Make your first one with New agent.",
          };
  }
}

/** @returns {SideNote} */
function localNote(/** @type {Sides["local"]} */ side) {
  switch (side.state) {
    case "loading":
      return { state: side.state, text: "Looking for agent programs on this computer…" };
    case "unavailable":
      return { state: side.state, text: "This desk does not look for agent programs." };
    case "denied":
      return {
        state: side.state,
        text: "Not allowed to see the agent programs on this computer.",
        action: "retry",
      };
    case "error":
      return {
        state: side.state,
        text: `The agent programs could not be read: ${side.error}`,
        action: "retry",
      };
    default:
      return side.agents.length
        ? { state: side.state, text: "" }
        : {
            state: side.state,
            text: "No agent programs on this computer yet. Claude Code and Codex show here once installed.",
          };
  }
}
