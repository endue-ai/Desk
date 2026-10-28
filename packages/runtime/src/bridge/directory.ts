/**
 * The browser stub's agents and spaces: the same people as examples/brain-echo, answering listAgents,
 * listSpaces and listSpaceAgents the way endue AI's API gateway does (specs/brain/v0).
 */
import type {
  Agent,
  AgentList,
  Space,
  SpaceAgent,
  SpaceAgentList,
  SpaceList,
} from "@endue-ai/bridge";
import type { AgentQuery } from "./types";

export interface Directory {
  spaces: Space[];
  agents: Agent[];
  spaceAgents: SpaceAgent[];
}

export const agentId = (n: number) => `ag_01JBZ8Q4MR00000000000000${String(n).padStart(2, "0")}`;

const CREATED = "2026-10-01T09:00:00.000Z";

export function sampleDirectory(): Directory {
  // Mira is the newest, so newest-first lists read Mira, Theo, Juno, Kai, Lena (as brain-echo).
  const agent = (n: number, name: string, status: Agent["status"], description: string): Agent => {
    const at = `2026-10-0${7 - n}T09:00:00.000Z`;
    return {
      id: agentId(n),
      slug: name.toLowerCase(),
      name,
      status,
      description,
      created_at: at,
      updated_at: at,
    };
  };
  const space = (id: string, name: string, front: number, description?: string): Space => ({
    id,
    key: id.replace(/^sp_/, ""),
    name,
    ...(description ? { description } : {}),
    type: "workspace",
    status: "active",
    front_agent_id: agentId(front),
    created_at: CREATED,
    updated_at: CREATED,
  });
  const member = (spaceId: string, n: number, front = false): SpaceAgent => ({
    id: `spa_${spaceId}_${n}`,
    space_id: spaceId,
    agent_id: agentId(n),
    role_key: "generalist",
    is_front: front,
    permission: front ? "admin" : "participant",
    status: "active",
    created_at: CREATED,
    updated_at: CREATED,
  });
  return {
    spaces: [space("sp_home", "Home", 1), space("sp_studio", "Studio", 4, "Client work")],
    agents: [
      agent(1, "Mira", "active", "Keeps the inbox and the calendar in order."),
      agent(2, "Theo", "active", "Takes notes and keeps them tidy."),
      agent(3, "Juno", "inactive", "Files receipts and pays the bills."),
      agent(4, "Kai", "active", "Plans trips."),
      agent(5, "Lena", "active", "Writes briefs and copy for clients."),
    ],
    spaceAgents: [
      member("sp_home", 1, true),
      member("sp_home", 2),
      member("sp_home", 3),
      member("sp_studio", 4, true),
      member("sp_studio", 5),
    ],
  };
}

/** Error with the HTTP status the gateway would answer. */
export class DirectoryError extends Error {
  constructor(
    readonly status: number,
    readonly code: "not_found",
    message: string,
  ) {
    super(message);
  }
}

/** Newest first, as agent-service lists; the gateway lowers a limit over 50 and a page under 1. */
export function listAgents(d: Directory, query: AgentQuery = {}): AgentList {
  const limit = Math.min(50, Math.max(1, Math.floor(query.limit ?? 20)));
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const all = d.agents
    .map((agent, i) => ({ agent, i, t: Date.parse(agent.created_at) }))
    .sort((a, b) => b.t - a.t || a.i - b.i)
    .map((x) => x.agent);
  return {
    items: all.slice((page - 1) * limit, page * limit),
    pagination: { total: all.length, page, limit, has_next_page: page * limit < all.length },
  };
}

/** Active spaces only, as a plain array. */
export function listSpaces(d: Directory): SpaceList {
  return d.spaces.filter((sp) => (sp.status ?? "active") === "active");
}

export function listSpaceAgents(d: Directory, spaceId: string, now: string): SpaceAgentList {
  if (!d.spaces.some((sp) => sp.id === spaceId)) {
    throw new DirectoryError(404, "not_found", `No space ${spaceId}.`);
  }
  return {
    data: d.spaceAgents.filter((a) => a.space_id === spaceId),
    meta: { request_id: "stub", timestamp: now },
  };
}
