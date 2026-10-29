/**
 * The browser stub's agent directory: the same people as examples/brain-echo, answering listAgents,
 * getAgentCard, listSpaces and listA2ATasks the way specs/brain/v0 says (filters, pages, 404).
 */
import type { A2ATask, A2ATaskList, Agent, AgentCard, AgentList, Space } from "@endue-ai/bridge";
import type { AgentQuery, TaskQuery } from "./types";

export interface Directory {
  spaces: Space[];
  /** Agents with the space each one is in. */
  agents: { agent: Agent; spaceId: string }[];
  cards: AgentCard[];
  tasks: A2ATask[];
}

const OWNER = "u_01JBZ8Q4MR0000000000000000";
export const agentId = (n: number) => `ag_01JBZ8Q4MR00000000000000${String(n).padStart(2, "0")}`;
const taskId = (n: number) => `a2a_01JBZ8Q4MR00000000000000${String(n).padStart(2, "0")}`;

/** Sample directory; timestamps are relative to `epoch` so elapsed times are fixed in tests. */
export function sampleDirectory(epoch: number): Directory {
  const at = (msBefore: number) => new Date(epoch - msBefore).toISOString();
  const created = "2026-10-01T09:00:00.000Z";
  const space = (id: string, key: string, name: string, description?: string): Space => ({
    id,
    key,
    name,
    ...(description ? { description } : {}),
    type: "workspace",
    createdAt: created,
    updatedAt: created,
  });
  // Mira is the newest, so newest-first lists read Mira, Theo, Juno, Kai, Lena (as brain-echo).
  const agent = (n: number, name: string, status: Agent["status"]): Agent => {
    const at = `2026-10-0${7 - n}T09:00:00.000Z`;
    return {
      id: agentId(n),
      name,
      slug: name.toLowerCase(),
      status,
      ownerUserId: OWNER,
      createdAt: at,
      updatedAt: at,
    };
  };
  const card = (
    n: number,
    description: string,
    enabled: boolean,
    maxConcurrentTasks: number,
    skills: [string, string, string, string[]?][],
  ): AgentCard => ({
    agentId: agentId(n),
    name: ["Mira", "Theo", "Juno", "Kai", "Lena"][n - 1] ?? "",
    description,
    enabled,
    skills: skills.map(([id, name, what, modes]) => ({
      id,
      name,
      description: what,
      inputModes: modes ?? ["text"],
    })),
    capabilities: { streaming: n !== 3, maxConcurrentTasks },
  });
  const task = (
    n: number,
    from: number,
    to: number,
    status: A2ATask["status"],
    goal: string,
    startedMsAgo: number,
    progress?: number,
  ): A2ATask => ({
    id: taskId(n),
    sourceAgentId: agentId(from),
    targetAgentId: agentId(to),
    status,
    goal,
    depth: 1,
    maxDepth: 3,
    messageCount: 2,
    ...(progress === undefined ? {} : { progress }),
    insertedAt: at(startedMsAgo),
    updatedAt: at(0),
  });
  return {
    spaces: [
      space("sp_home", "home", "Home"),
      space("sp_studio", "studio", "Studio", "Client work"),
    ],
    agents: [
      { agent: agent(1, "Mira", "active"), spaceId: "sp_home" },
      { agent: agent(2, "Theo", "active"), spaceId: "sp_home" },
      { agent: agent(3, "Juno", "inactive"), spaceId: "sp_home" },
      { agent: agent(4, "Kai", "active"), spaceId: "sp_studio" },
      { agent: agent(5, "Lena", "active"), spaceId: "sp_studio" },
    ],
    cards: [
      card(1, "Keeps the inbox and the calendar in order.", true, 2, [
        ["inbox.sort", "Sort the inbox", "Files, answers or flags each new mail."],
        ["calendar.plan", "Plan the day", "Finds time for meetings and moves the overlaps."],
      ]),
      card(2, "Takes notes and keeps them tidy.", true, 1, [
        [
          "notes.tidy",
          "Tidy meeting notes",
          "Turns rough notes into decisions and next steps.",
          ["text", "file"],
        ],
      ]),
      card(3, "Files receipts and pays the bills.", false, 1, [
        [
          "receipts.file",
          "File receipts",
          "Reads receipts and files them by month.",
          ["text", "file"],
        ],
      ]),
      card(4, "Plans trips.", true, 3, [
        ["flights.compare", "Compare flights", "Compares flights by price, time and stops."],
        ["hotels.find", "Find a hotel", "Finds hotels close to where the trip goes."],
      ]),
      card(5, "Writes briefs and copy for clients.", true, 2, [
        [
          "brief.draft",
          "Draft the brief",
          "Drafts a brief from notes and references.",
          ["text", "file"],
        ],
      ]),
    ],
    tasks: [
      task(1, 2, 1, "working", "Sort the inbox", 4 * 60_000 + 12_000, 0.62),
      task(2, 1, 4, "working", "Compare flights", 65_000, 0.25),
      task(3, 1, 2, "submitted", "Tidy meeting notes", 30_000),
      task(4, 4, 5, "completed", "Draft the brief", 3_600_000),
    ],
  };
}

/** Contract error, shaped like BrainError. */
export class DirectoryError extends Error {
  constructor(
    readonly status: number,
    readonly code: "invalid_request" | "not_found",
    message: string,
  ) {
    super(message);
  }
}

function page<T>(items: T[], query: { page?: number; limit?: number }) {
  const p = query.page ?? 1;
  const limit = query.limit ?? 20;
  if (!Number.isInteger(p) || p < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new DirectoryError(400, "invalid_request", "page starts at 1 and limit is 1 to 100.");
  }
  return {
    items: items.slice((p - 1) * limit, p * limit),
    pagination: { total: items.length, page: p, limit, hasNextPage: p * limit < items.length },
  };
}

/** Newest first, as the contract lists; ties keep their order. */
const newest = <T>(items: T[], at: (item: T) => string) =>
  items
    .map((item, i) => ({ item, i, t: Date.parse(at(item)) }))
    .sort((a, b) => b.t - a.t || a.i - b.i)
    .map((x) => x.item);

export function listAgents(d: Directory, query: AgentQuery = {}): AgentList {
  return page(
    newest(
      d.agents
        .filter((a) => query.spaceId === undefined || a.spaceId === query.spaceId)
        .filter((a) => query.status === undefined || a.agent.status === query.status)
        .map((a) => a.agent),
      (a) => a.createdAt,
    ),
    query,
  );
}

export function agentCard(d: Directory, id: string): AgentCard {
  const card = d.cards.find((c) => c.agentId === id);
  if (!card) throw new DirectoryError(404, "not_found", `No agent ${id}.`);
  return card;
}

export function listTasks(d: Directory, query: TaskQuery = {}): A2ATaskList {
  return page(
    newest(
      d.tasks
        .filter((t) => query.targetAgentId === undefined || t.targetAgentId === query.targetAgentId)
        .filter((t) => query.status === undefined || t.status === query.status),
      (t) => t.insertedAt,
    ),
    query,
  );
}
