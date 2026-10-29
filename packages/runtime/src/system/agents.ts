/**
 * The agent list of the system layer, read from the agent directory of specs/brain/v0 (endue AI's
 * agents and A2A tasks). An agent is working while an A2A task it was handed is working, and waits
 * at the edge while it is inactive. Archived agents are not listed.
 */
import type { A2ATask, Agent } from "@endue-ai/bridge";
import type { Ctx } from "../shell/actions";
import type { DeskState } from "../shell/state";
import { openView } from "../shell/windows";

export type Presence = "working" | "waiting" | "idle";

const PAGE = { limit: 100 };

export function presenceOf(agent: Agent, tasks: readonly A2ATask[]): Presence {
  if (tasks.some((t) => t.targetAgentId === agent.id && t.status === "working")) return "working";
  return agent.status === "inactive" ? "waiting" : "idle";
}

/** The current space's agents, in the order the brain listed them. */
export function spaceAgents(s: DeskState): Agent[] {
  const byId = new Map(s.agents.map((a) => [a.id, a]));
  return s.spaceAgents.flatMap((id) => byId.get(id) ?? []);
}

export function agentName(s: DeskState, id: string): string {
  return s.agents.find((a) => a.id === id)?.name ?? id;
}

/** Tasks still open: submitted, working or waiting for input. */
export const isOpen = (t: A2ATask) =>
  t.status === "submitted" || t.status === "working" || t.status === "input_required";

async function inSpace(ctx: Ctx, spaceId: string): Promise<string[]> {
  if (!spaceId) return [];
  const page = await ctx.bridge.agents.list({ spaceId, ...PAGE });
  return page.items.filter((a) => a.status !== "archived").map((a) => a.id);
}

/** Load spaces, agents and A2A tasks; keeps the saved space when it still exists. */
export async function loadDirectory(ctx: Ctx): Promise<void> {
  try {
    const [spaces, agents, tasks] = await Promise.all([
      ctx.bridge.spaces.list(),
      ctx.bridge.agents.list(PAGE),
      ctx.bridge.a2a.tasks(PAGE),
    ]);
    const saved = ctx.store.get().spaceId;
    const spaceId = spaces.items.some((sp) => sp.id === saved)
      ? saved
      : (spaces.items[0]?.id ?? "");
    const ids = await inSpace(ctx, spaceId);
    ctx.store.set((s) => ({
      spaces: spaces.items,
      agents: agents.items,
      tasks: tasks.items,
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

/** Read an agent's A2A card once; "missing" when the brain has none. */
export async function loadCard(ctx: Ctx, agentId: string): Promise<void> {
  if (ctx.store.get().cards[agentId]) return;
  try {
    const card = await ctx.bridge.agents.card(agentId);
    ctx.store.set((s) => ({ cards: { ...s.cards, [agentId]: card } }));
  } catch {
    ctx.store.set((s) => ({ cards: { ...s.cards, [agentId]: "missing" } }));
  }
}

/** Select an agent: its screen comes to the middle of the desk, with its A2A card. */
export function selectAgent(ctx: Ctx, id: string): void {
  ctx.store.set({ agentId: id });
  openView(ctx, `agent:${id}`);
  void loadCard(ctx, id);
}
