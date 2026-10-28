/**
 * The agent list of the system layer, read the way endue AI's API gateway serves it
 * (specs/brain/v0): the person's agents from /api/v1/agents, the spaces from /api/v1/spaces, and
 * which agents take part in a space from /api/v1/spaces/{id}/agents. An inactive agent waits at the
 * edge; archived and deleted agents, and agents removed from the space, are not listed.
 */
import type { Agent } from "@endue-ai/bridge";
import type { Ctx } from "../shell/actions";
import type { DeskState, Task } from "../shell/state";
import { openView } from "../shell/windows";

export type Presence = "working" | "waiting" | "idle";

/** The gateway answers at most 50 agents a page; read up to this many pages. */
const LIMIT = 50;
const MAX_PAGES = 10;

export function presenceOf(agent: Agent, tasks: readonly Task[]): Presence {
  if (tasks.some((t) => t.agent === agent.id && t.running)) return "working";
  return agent.status === "inactive" ? "waiting" : "idle";
}

const shown = (a: Agent) => a.status === "active" || a.status === "inactive";

/** The current space's agents, in the order the gateway listed them. */
export function spaceAgents(s: DeskState): Agent[] {
  const byId = new Map(s.agents.map((a) => [a.id, a]));
  return s.spaceAgents.flatMap((id) => {
    const agent = byId.get(id);
    return agent && shown(agent) ? [agent] : [];
  });
}

export function agentName(s: DeskState, id: string): string {
  return s.agents.find((a) => a.id === id)?.name ?? id;
}

/** Every agent the person owns, following has_next_page. */
async function allAgents(ctx: Ctx): Promise<Agent[]> {
  const out: Agent[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const answer = await ctx.bridge.agents.list({ page, limit: LIMIT });
    out.push(...answer.items);
    if (!answer.pagination.has_next_page) break;
  }
  return out;
}

async function inSpace(ctx: Ctx, spaceId: string): Promise<string[]> {
  if (!spaceId) return [];
  const answer = await ctx.bridge.spaces.agents(spaceId);
  return answer.data.filter((a) => a.status === "active").map((a) => a.agent_id);
}

/** Load spaces and agents; keeps the saved space when it still exists. */
export async function loadDirectory(ctx: Ctx): Promise<void> {
  try {
    const [spaces, agents] = await Promise.all([ctx.bridge.spaces.list(), allAgents(ctx)]);
    const saved = ctx.store.get().spaceId;
    const spaceId = spaces.some((sp) => sp.id === saved) ? saved : (spaces[0]?.id ?? "");
    const ids = await inSpace(ctx, spaceId);
    ctx.store.set((s) => ({
      spaces,
      agents,
      spaceId,
      spaceAgents: ids,
      agentId: s.agentId && ids.includes(s.agentId) ? s.agentId : (ids[0] ?? null),
      directory: "ready",
    }));
  } catch {
    ctx.store.set({ directory: "offline" });
  }
}

/** Switch spaces: the agent list (and what they may do) follows the space. */
export async function selectSpace(ctx: Ctx, spaceId: string): Promise<void> {
  ctx.store.set({ spaceId });
  try {
    const ids = await inSpace(ctx, spaceId);
    if (ctx.store.get().spaceId !== spaceId) return;
    ctx.store.set({ spaceAgents: ids, agentId: ids[0] ?? null, directory: "ready" });
  } catch {
    ctx.store.set({ directory: "offline" });
  }
}

/** Select an agent: its screen comes to the middle of the desk. */
export function selectAgent(ctx: Ctx, id: string): void {
  ctx.store.set({ agentId: id });
  openView(ctx, `agent:${id}`);
}
