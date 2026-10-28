// brain-echo's agent directory, as specs/brain/v0/openapi.yaml describes it: two spaces, five agents
// with their A2A cards and four tasks the agents handed to each other. The data is fixed (timestamps
// included), so every answer is the same; server.mjs only carries it over HTTP.
import { BrainError } from "./brain.mjs";

const OWNER = "u_01JBZ8Q4MR0000000000000000";
const HOME = "sp_home";
const STUDIO = "sp_studio";
const MIRA = "ag_01JBZ8Q4MR0000000000000001";
const THEO = "ag_01JBZ8Q4MR0000000000000002";
const JUNO = "ag_01JBZ8Q4MR0000000000000003";
const KAI = "ag_01JBZ8Q4MR0000000000000004";
const LENA = "ag_01JBZ8Q4MR0000000000000005";

const AGENT_STATUSES = ["active", "inactive", "archived"];
const TASK_STATUSES = ["submitted", "working", "input_required", "completed", "failed", "canceled"];

const SPACES = [
  {
    id: HOME,
    key: "home",
    name: "Home",
    type: "workspace",
    createdAt: "2026-10-01T09:00:00Z",
    updatedAt: "2026-10-01T09:00:00Z",
  },
  {
    id: STUDIO,
    key: "studio",
    name: "Studio",
    description: "Client work",
    type: "workspace",
    createdAt: "2026-10-01T09:00:00Z",
    updatedAt: "2026-10-01T09:00:00Z",
  },
];

const skill = (id, name, description, inputModes = ["text"]) => ({
  id,
  name,
  description,
  inputModes,
});

// Each agent with the space it works in and its A2A card; the Agent schema carries neither. Mira
// is the newest, so lists come out as Mira, Theo, Juno, Kai, Lena.
const AGENTS = [
  {
    space: HOME,
    agent: {
      id: MIRA,
      name: "Mira",
      slug: "mira",
      status: "active",
      ownerUserId: OWNER,
      personalColor: "#9683D3",
      createdAt: "2026-10-06T09:00:00Z",
      updatedAt: "2026-10-27T09:00:00Z",
    },
    card: {
      description: "Keeps the inbox and the calendar in order.",
      enabled: true,
      skills: [
        skill("inbox.sort", "Sort the inbox", "Files, answers or flags each new mail."),
        skill("calendar.plan", "Plan the day", "Finds time for meetings and moves the overlaps."),
      ],
      capabilities: { streaming: true, maxConcurrentTasks: 2 },
    },
  },
  {
    space: HOME,
    agent: {
      id: THEO,
      name: "Theo",
      slug: "theo",
      status: "active",
      ownerUserId: OWNER,
      personalColor: "#6FA8DC",
      createdAt: "2026-10-05T09:00:00Z",
      updatedAt: "2026-10-26T09:00:00Z",
    },
    card: {
      description: "Takes notes and keeps them tidy.",
      enabled: true,
      skills: [
        skill(
          "notes.tidy",
          "Tidy meeting notes",
          "Turns rough notes into decisions and next steps.",
          ["text", "file"],
        ),
      ],
      capabilities: { streaming: true, maxConcurrentTasks: 1 },
    },
  },
  {
    space: HOME,
    agent: {
      id: JUNO,
      name: "Juno",
      slug: "juno",
      status: "inactive",
      ownerUserId: OWNER,
      personalColor: "#E0A458",
      createdAt: "2026-10-04T09:00:00Z",
      updatedAt: "2026-10-04T09:00:00Z",
    },
    card: {
      description: "Files receipts and pays the bills.",
      enabled: false,
      skills: [
        skill("receipts.file", "File receipts", "Reads receipts and files them by month.", [
          "text",
          "file",
        ]),
      ],
      capabilities: { streaming: false, maxConcurrentTasks: 1 },
    },
  },
  {
    space: STUDIO,
    agent: {
      id: KAI,
      name: "Kai",
      slug: "kai",
      status: "active",
      ownerUserId: OWNER,
      personalColor: "#5FB49C",
      createdAt: "2026-10-03T09:00:00Z",
      updatedAt: "2026-10-25T09:00:00Z",
    },
    card: {
      description: "Plans trips.",
      enabled: true,
      skills: [
        skill("flights.compare", "Compare flights", "Compares flights by price, time and stops."),
        skill("hotels.find", "Find a hotel", "Finds hotels close to where the trip goes."),
      ],
      capabilities: { streaming: true, maxConcurrentTasks: 3 },
    },
  },
  {
    space: STUDIO,
    agent: {
      id: LENA,
      name: "Lena",
      slug: "lena",
      status: "active",
      ownerUserId: OWNER,
      personalColor: "#D9779A",
      createdAt: "2026-10-02T09:00:00Z",
      updatedAt: "2026-10-24T09:00:00Z",
    },
    card: {
      description: "Writes briefs and copy for clients.",
      enabled: true,
      skills: [
        skill("brief.draft", "Draft the brief", "Drafts a brief from notes and references.", [
          "text",
          "file",
        ]),
      ],
      capabilities: { streaming: true, maxConcurrentTasks: 2 },
    },
  },
];

const TASKS = [
  {
    id: "a2a_01JBZ8Q4MR0000000000000001",
    contextId: "ctx-inbox",
    sourceAgentId: THEO,
    targetAgentId: MIRA,
    status: "working",
    goal: "Sort the inbox",
    depth: 1,
    maxDepth: 3,
    messageCount: 4,
    progress: 0.62,
    insertedAt: "2026-10-28T08:55:48Z",
    updatedAt: "2026-10-28T08:59:00Z",
  },
  {
    id: "a2a_01JBZ8Q4MR0000000000000002",
    contextId: "ctx-trip",
    sourceAgentId: MIRA,
    targetAgentId: KAI,
    status: "working",
    goal: "Compare flights",
    depth: 1,
    maxDepth: 3,
    messageCount: 2,
    progress: 0.25,
    insertedAt: "2026-10-28T08:58:55Z",
    updatedAt: "2026-10-28T08:59:30Z",
  },
  {
    id: "a2a_01JBZ8Q4MR0000000000000003",
    contextId: "ctx-notes",
    sourceAgentId: MIRA,
    targetAgentId: THEO,
    status: "submitted",
    goal: "Tidy meeting notes",
    depth: 1,
    maxDepth: 3,
    messageCount: 1,
    insertedAt: "2026-10-28T08:59:40Z",
    updatedAt: "2026-10-28T08:59:40Z",
  },
  {
    id: "a2a_01JBZ8Q4MR0000000000000004",
    contextId: "ctx-brief",
    sourceAgentId: KAI,
    targetAgentId: LENA,
    status: "completed",
    goal: "Draft the brief",
    result: { artifacts: [{ name: "brief.pdf" }] },
    depth: 1,
    maxDepth: 3,
    messageCount: 3,
    progress: 1,
    insertedAt: "2026-10-28T08:12:00Z",
    updatedAt: "2026-10-28T08:41:00Z",
  },
];

const invalid = (message) => new BrainError(400, "invalid_request", message);

/** A query parameter given at most once: its value, or null when it is absent. */
function single(query, name) {
  const values = query.getAll(name);
  if (values.length > 1) throw invalid(`${name} is given ${values.length} times.`);
  return values[0] ?? null;
}

/** An id filter: absent, or not empty. */
function filter(query, name) {
  const value = single(query, name);
  if (value === "") throw invalid(`${name} is empty; leave it out to keep everything.`);
  return value;
}

/** One of `allowed`, or null when the parameter is absent. */
function oneOf(query, name, allowed) {
  const value = single(query, name);
  if (value !== null && !allowed.includes(value))
    throw invalid(`${name} is one of ${allowed.join(", ")}, not "${value}".`);
  return value;
}

/** A whole number from 1 (up to `max`), or `fallback` when the parameter is absent. */
function whole(query, name, fallback, max = Number.POSITIVE_INFINITY) {
  const raw = single(query, name);
  if (raw === null) return fallback;
  const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    const range = max === Number.POSITIVE_INFINITY ? "from 1" : `from 1 to ${max}`;
    throw invalid(`${name} is a whole number ${range}, not "${raw}".`);
  }
  return value;
}

/** One page of `items`, newest first by their `at` timestamp, as the query asks. */
function onePage(items, at, query) {
  const page = whole(query, "page", 1);
  const limit = whole(query, "limit", 20, 100);
  const newest = items.toSorted((a, b) => Date.parse(b[at]) - Date.parse(a[at]));
  const start = (page - 1) * limit;
  return {
    items: newest.slice(start, start + limit),
    pagination: { total: newest.length, page, limit, hasNextPage: start + limit < newest.length },
  };
}

/** listSpaces: every space. */
export function listSpaces() {
  return { items: SPACES };
}

/** listAgents: the agents in spaceId with status, when given. `query` is a URLSearchParams. */
export function listAgents(query) {
  const spaceId = filter(query, "spaceId");
  const status = oneOf(query, "status", AGENT_STATUSES);
  const kept = AGENTS.filter(
    (entry) =>
      (spaceId === null || entry.space === spaceId) &&
      (status === null || entry.agent.status === status),
  ).map((entry) => entry.agent);
  return onePage(kept, "createdAt", query);
}

/** getAgentCard: an agent's A2A card; not_found for an agent nobody has. */
export function getAgentCard(agentId) {
  const entry = AGENTS.find((e) => e.agent.id === agentId);
  if (!entry) throw new BrainError(404, "not_found", `There is no agent ${agentId}.`);
  return { agentId, name: entry.agent.name, ...entry.card };
}

/** listA2ATasks: the tasks targetAgentId is doing with status, when given. */
export function listA2ATasks(query) {
  const target = filter(query, "targetAgentId");
  const status = oneOf(query, "status", TASK_STATUSES);
  const kept = TASKS.filter(
    (task) =>
      (target === null || task.targetAgentId === target) &&
      (status === null || task.status === status),
  );
  return onePage(kept, "insertedAt", query);
}
