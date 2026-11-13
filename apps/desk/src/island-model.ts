// What the island shows (ADR 0204), without a DOM: the agents at work, from agent.list (read again
// whenever the core says one of their runs changed, agent.changed) and the runs of the agent programs
// on this computer (agents.runs, then agents.run as they start and end), and the asks that wait for
// the person, from perm.pending and then the core's events as they come and go (perm.prompt and
// perm.approval in, perm.settled out). Plain data in, plain data out.
import type {
  AgentRecord,
  BridgeEvent,
  LocalAgentId,
  LocalAgentRun,
  PermApprovalData,
  PermPendingResult,
  PermPromptData,
} from "@endue-ai/bridge";

/** An agent at work, as the island names it. */
export interface Worker {
  id: string;
  name: string;
  colour?: string;
}

/** One ask that waits for the person: a permission prompt or an agent's approval. */
export interface Ask {
  kind: "prompt" | "approval";
  id: string;
  /** Who asks, in words. */
  who: string;
  /** What for, in words. */
  what: string;
}

export interface IslandState {
  working: Worker[];
  asks: Ask[];
}

export const QUIET: IslandState = { working: [], asks: [] };

/** The agent programs agents.ask runs, by the names people know them by. */
const PROGRAMS: Record<LocalAgentId, string> = { claude: "Claude Code", codex: "Codex" };

/** One run of an agent program at work, keyed by its run so its end takes it off. */
const programAt = (agent: LocalAgentId, runId: string): Worker => ({
  id: `run:${runId}`,
  name: PROGRAMS[agent] ?? agent,
});

/** The runs agents.runs says are running, by run id. */
export function runningOf(runs: LocalAgentRun[]): Map<string, Worker> {
  const running = runs.filter((run) => run.state === "running");
  return new Map(running.map((run) => [run.runId, programAt(run.agent, run.runId)]));
}

/** The runs at work after `event`, or undefined when it changes none: started in, ended out. */
export function runsAfter(
  runs: Map<string, Worker>,
  event: BridgeEvent,
): Map<string, Worker> | undefined {
  if (event.event !== "agents.run") return undefined;
  const { runId, agent, kind } = event.data;
  const next = new Map(runs);
  if (kind === "started") next.set(runId, programAt(agent, runId));
  else if (kind === "done" || kind === "failed" || kind === "stopped") next.delete(runId);
  else return undefined;
  return next;
}

/** A caller in words: an agent by its id, the desk as the desk, a plugin by its id. */
export function callerName(caller: string): string {
  if (caller === "desk") return "endue";
  return caller.startsWith("agent:") ? caller.slice("agent:".length) : caller;
}

export function promptAsk(prompt: PermPromptData): Ask {
  return {
    kind: "prompt",
    id: prompt.promptId,
    who: callerName(prompt.caller),
    what: `asks for ${prompt.permission.permission}`,
  };
}

export function approvalAsk(approval: PermApprovalData): Ask {
  return {
    kind: "approval",
    id: approval.approvalId,
    who: callerName(approval.caller),
    what: `waits to run ${approval.action} on ${approval.target}`,
  };
}

/** What perm.pending says waits, prompts first, each oldest first. */
export function asksOf(pending: PermPendingResult): Ask[] {
  return [...pending.prompts.map(promptAsk), ...pending.approvals.map(approvalAsk)];
}

/** The agents agent.list says are working now, in its order (Eris first, then by name). */
export function workingOf(agents: AgentRecord[]): Worker[] {
  return agents
    .filter((agent) => agent.state === "working")
    .map(({ id, name, colour }) => (colour ? { id, name, colour } : { id, name }));
}

/** The asks after `event`, or undefined when it changes none. */
export function asksAfter(asks: Ask[], event: BridgeEvent): Ask[] | undefined {
  const add = (ask: Ask) =>
    asks.some((a) => a.kind === ask.kind && a.id === ask.id) ? undefined : [...asks, ask];
  switch (event.event) {
    case "perm.prompt":
      return add(promptAsk(event.data));
    case "perm.approval":
      return add(approvalAsk(event.data));
    case "perm.settled": {
      const { kind, id } = event.data;
      const left = asks.filter((a) => !(a.kind === kind && a.id === id));
      return left.length === asks.length ? undefined : left;
    }
    default:
      return undefined;
  }
}

/** The core says one of an agent's runs changed (`agent.changed`): agent.list is read again. */
export function touchesAgents(event: BridgeEvent): boolean {
  return event.event === "agent.changed";
}

const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The closed island's line: what is going on in a few words. */
export function summary({ working, asks }: IslandState): string {
  const parts: string[] = [];
  if (working.length > 0) parts.push(counted(working.length, "agent at work", "agents at work"));
  if (asks.length > 0) parts.push(counted(asks.length, "ask waits", "asks wait"));
  return parts.length > 0 ? parts.join(" · ") : "All quiet";
}
