// brain-echo's agent directory, shaped like endue AI's API gateway as specs/brain/v0/openapi.yaml
// describes it: GET /api/v1/agents, /api/v1/spaces and /api/v1/spaces/{spaceId}/agents, with the
// gateway's snake_case names. Two spaces and five agents, fixed (timestamps included), so every
// answer is the same; server.mjs serves these at its root, beside the brain under /v0.
import { BrainError } from "./brain.mjs";

const HOME = "sp_home";
const STUDIO = "sp_studio";
const MIRA = "ag_01JBZ8Q4MR0000000000000001";
const THEO = "ag_01JBZ8Q4MR0000000000000002";
const JUNO = "ag_01JBZ8Q4MR0000000000000003";
const KAI = "ag_01JBZ8Q4MR0000000000000004";
const LENA = "ag_01JBZ8Q4MR0000000000000005";
const OPENED = "2026-10-01T09:00:00.000Z";
// The gateway stamps each answer; brain-echo stamps them all alike so answers stay the same.
const META = { request_id: "req_brain_echo", timestamp: "2026-10-28T09:00:00.000Z" };

const SPACES = [
  {
    id: HOME,
    key: "home",
    name: "Home",
    type: "workspace",
    status: "active",
    front_agent_id: MIRA,
    created_at: OPENED,
    updated_at: OPENED,
  },
  {
    id: STUDIO,
    key: "studio",
    name: "Studio",
    description: "Client work",
    type: "workspace",
    status: "active",
    front_agent_id: KAI,
    created_at: OPENED,
    updated_at: OPENED,
  },
];

const agent = (id, name, status, personal_color, description, created_at, updated_at) => ({
  id,
  slug: name.toLowerCase(),
  name,
  status,
  personal_color,
  description,
  live_enabled: false,
  pinned_at: null,
  created_at,
  updated_at,
});

// Newest first, as the gateway lists them: Mira is the newest.
const AGENTS = [
  {
    ...agent(
      MIRA,
      "Mira",
      "active",
      "#9683D3",
      "Keeps the inbox and the calendar in order.",
      "2026-10-06T09:00:00.000Z",
      "2026-10-27T09:00:00.000Z",
    ),
    pinned_at: "2026-10-20T09:00:00.000Z",
  },
  agent(
    THEO,
    "Theo",
    "active",
    "#6FA8DC",
    "Takes notes and keeps them tidy.",
    "2026-10-05T09:00:00.000Z",
    "2026-10-26T09:00:00.000Z",
  ),
  agent(
    JUNO,
    "Juno",
    "inactive",
    "#E0A458",
    "Files receipts and pays the bills.",
    "2026-10-04T09:00:00.000Z",
    "2026-10-04T09:00:00.000Z",
  ),
  agent(
    KAI,
    "Kai",
    "active",
    "#5FB49C",
    "Plans trips.",
    "2026-10-03T09:00:00.000Z",
    "2026-10-25T09:00:00.000Z",
  ),
  agent(
    LENA,
    "Lena",
    "active",
    "#D9779A",
    "Writes briefs and copy for clients.",
    "2026-10-02T09:00:00.000Z",
    "2026-10-24T09:00:00.000Z",
  ),
];

const member = (space_id, agent_id, role_key, is_front) => ({
  id: `spa_${space_id.slice(3)}_${agent_id.slice(-2)}`,
  space_id,
  agent_id,
  role_key,
  is_front,
  permission: is_front ? "admin" : "participant",
  status: "active",
  created_at: OPENED,
  updated_at: OPENED,
});

// One row per agent in its space; the front agent answers the person there.
const MEMBERS = [
  member(HOME, MIRA, "generalist", true),
  member(HOME, THEO, "writer", false),
  member(HOME, JUNO, "analyst", false),
  member(STUDIO, KAI, "generalist", true),
  member(STUDIO, LENA, "writer", false),
];

/** A whole-number parameter, or `fallback` when it is absent or not a number. */
function whole(query, name, fallback) {
  const value = Number.parseInt(query.get(name) ?? "", 10);
  return Number.isNaN(value) ? fallback : value;
}

/** GET /api/v1/agents: like the agent service, page is at least 1 and limit is 1 to 50. */
export function listAgents(query) {
  const page = Math.max(1, whole(query, "page", 1));
  const limit = Math.min(50, Math.max(1, whole(query, "limit", 20)));
  const newest = AGENTS.toSorted((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const start = (page - 1) * limit;
  return {
    items: newest.slice(start, start + limit),
    pagination: { total: newest.length, page, limit, has_next_page: start + limit < newest.length },
  };
}

/** GET /api/v1/spaces: every active space, as a plain array. */
export function listSpaces() {
  return SPACES;
}

/** GET /api/v1/spaces/{spaceId}/agents: the space's agents in the data and meta envelope. */
export function listSpaceAgents(spaceId) {
  if (!SPACES.some((space) => space.id === spaceId))
    throw new BrainError(404, "not_found", `There is no space ${spaceId}.`);
  return { data: MEMBERS.filter((m) => m.space_id === spaceId), meta: META };
}
