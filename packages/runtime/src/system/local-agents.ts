/**
 * The agent programs on this computer in the shell (ADR 0110): the core finds Claude Code and Codex
 * by their own files (agents.list), the agent bar lists each one it found, and its screen opens as
 * the view `local:<id>`. Runs, the person's and Eris's, are kept from agents.runs and every
 * agents.run step, so a run started anywhere lights the agent's dot and shows on its screen.
 */
import type { LocalAgentId, LocalAgentRun, LocalAgentRunData } from "@endue-ai/bridge";
import type { Ctx } from "../shell/actions";
import { openView } from "../shell/windows";
import { LOCAL_VIEW } from "./local-ids";

export { badgeOf, isLocalAgent, LOCAL_VIEW, localName } from "./local-ids";

/** The longest answer a run keeps, as the core cuts it. */
const TEXT_MAX = 8000;
/** The runs the shell keeps, as the core does. */
const RUNS_MAX = 50;

export const isRunning = (run: LocalAgentRun) => run.state === "running";

/** Working while a run of it is going on. */
export function localPresence(id: string, runs: readonly LocalAgentRun[]): "working" | "idle" {
  return runs.some((r) => r.agent === id && isRunning(r)) ? "working" : "idle";
}

/** `text` cut to what a run keeps. */
const kept = (text: string) => (text.length > TEXT_MAX ? text.slice(0, TEXT_MAX) : text);

/**
 * The runs after one step: a step that carries its run (started, and every end) replaces it; a text
 * step adds a block to the answer and a tool step counts a tool. A step of a run the shell does not
 * know yet waits for the run it will bring.
 */
export function applyRunStep(
  runs: readonly LocalAgentRun[],
  data: LocalAgentRunData,
): LocalAgentRun[] {
  const at = runs.findIndex((r) => r.runId === data.runId);
  if (data.run) {
    const run = data.run;
    const rest = runs.filter((r) => r.runId !== run.runId);
    return at < 0 ? [run, ...rest].slice(0, RUNS_MAX) : runs.map((r, i) => (i === at ? run : r));
  }
  const known = runs[at];
  if (!known) return [...runs];
  const sessionId = data.sessionId ?? known.sessionId;
  let next: LocalAgentRun = { ...known, ...(sessionId ? { sessionId } : {}) };
  if (data.kind === "text" && data.text)
    next = { ...next, text: kept(next.text ? `${next.text}\n\n${data.text}` : data.text) };
  if (data.kind === "tool") next = { ...next, tools: next.tools + 1 };
  return runs.map((r, i) => (i === at ? next : r));
}

/** Read the agents found and their runs; a host without local agents leaves both empty. */
export async function loadLocalAgents(ctx: Ctx): Promise<void> {
  const local = ctx.bridge.localAgents;
  if (!local) return;
  const [agents, runs] = await Promise.all([
    local.list().catch(() => undefined),
    local.runs().catch(() => undefined),
  ]);
  ctx.store.set((s) => ({
    ...(agents ? { localAgents: agents } : {}),
    ...(runs ? { localRuns: runs } : { localRuns: s.localRuns }),
  }));
}

/**
 * Keep the state current: each run step updates its run, and a run's end or an import reads the
 * agents again (their counts changed). Returns the unsubscribe.
 */
export function watchLocalAgents(ctx: Ctx): () => void {
  const local = ctx.bridge.localAgents;
  if (!local) return () => undefined;
  return local.onEvent((event) => {
    if (event.kind === "changed") {
      void loadLocalAgents(ctx);
      return;
    }
    const data = event.data;
    ctx.store.set((s) => ({ localRuns: applyRunStep(s.localRuns, data) }));
    if (data.kind === "done" || data.kind === "failed" || data.kind === "stopped") {
      void local.list().then(
        (agents) => ctx.store.set({ localAgents: agents }),
        () => undefined,
      );
    }
  });
}

/** Open a local agent's screen in the middle of the desk. */
export function selectLocalAgent(ctx: Ctx, id: LocalAgentId): void {
  ctx.store.set({ popover: null });
  openView(ctx, `${LOCAL_VIEW}${id}`);
}
