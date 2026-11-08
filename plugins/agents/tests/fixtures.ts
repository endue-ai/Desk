// Fixture data for endue.agents: two local agent programs as agents.* answers them (ADR 0110) and
// two endue agents, their conversations and the catalog as studio.* answers them. Times are around
// Saturday 7 November 2026, 09:00 UTC.
import type {
  LocalAgent,
  LocalAgentMessage,
  LocalAgentRun,
  LocalAgentSession,
} from "../../../packages/bridge/src/index";

export const NOW = Date.parse("2026-11-07T09:00:00.000Z");

export const localAgents = (): LocalAgent[] => [
  {
    id: "claude",
    name: "Claude Code",
    vendor: "Anthropic",
    program: "/opt/homebrew/bin/claude",
    version: "2.1.3",
    home: "/Users/mina/.claude",
    sessions: 2,
    archived: 1,
    imported: 0,
    running: 0,
  },
  {
    id: "codex",
    name: "Codex",
    vendor: "OpenAI",
    version: "0.58.0",
    home: "/Users/mina/.codex",
    sessions: 1,
    archived: 0,
    imported: 0,
    running: 0,
  },
];

export const localSessions = (): Record<string, LocalAgentSession[]> => ({
  claude: [
    {
      id: "5b1d2c1e-0001-4000-8000-000000000001",
      agent: "claude",
      title: "Fix the flaky upload test",
      cwd: "/Users/mina/code/desk",
      branch: "main",
      updatedAt: "2026-11-07T08:30:00.000Z",
      archived: false,
      imported: false,
      size: 2048,
      model: "claude-opus-4",
    },
    {
      id: "5b1d2c1e-0002-4000-8000-000000000002",
      agent: "claude",
      title: "Explain the bridge",
      cwd: "/Users/mina/code/desk",
      updatedAt: "2026-11-05T10:00:00.000Z",
      archived: false,
      imported: false,
      size: 1024,
    },
  ],
  codex: [
    {
      id: "9c0de000-0001-4000-8000-000000000001",
      agent: "codex",
      title: "Rename the crate",
      cwd: "/Users/mina/code/garage",
      updatedAt: "2026-11-06T18:00:00.000Z",
      archived: false,
      imported: false,
      size: 512,
    },
  ],
});

export const transcript = (): LocalAgentMessage[] => [
  {
    role: "user",
    text: "Why does the upload test fail now and then?",
    at: "2026-11-07T08:20:00.000Z",
  },
  { role: "tool", name: "Read", text: "src/upload.test.ts" },
  {
    role: "assistant",
    text: "It races the clock: the timeout is 10 ms.",
    at: "2026-11-07T08:21:00.000Z",
  },
];

export const run = (over: Partial<LocalAgentRun> = {}): LocalAgentRun => ({
  runId: "run-7",
  agent: "claude",
  caller: "endue.agents",
  prompt: "Make it wait for the upload instead",
  cwd: "/Users/mina/code/desk",
  access: "read-only",
  state: "running",
  startedAt: "2026-11-07T08:59:00.000Z",
  text: "",
  tools: 0,
  ...over,
});

/** studio.agents.list's agents, as #547's core answers them (StudioAgent). */
export const endueAgents = () => [
  {
    id: "ag_miso",
    slug: "miso",
    name: "Miso",
    status: "active",
    personalColor: "#B6A3F5",
    createdAt: "2026-10-01T09:00:00Z",
    updatedAt: "2026-11-01T09:00:00Z",
  },
  {
    id: "ag_ria",
    slug: "ria",
    name: "Ria",
    status: "inactive",
    createdAt: "2026-10-02T09:00:00Z",
    updatedAt: "2026-10-20T09:00:00Z",
  },
];

/** studio.conversations.list's conversations (StudioConversation): running, waiting, failed, done. */
export const endueConversations = () => [
  {
    id: "cnv_run",
    agentId: "ag_miso",
    title: "Plan next week",
    status: "active",
    lastMessagePreview: "Looking at your calendar",
    lastRunStatus: "running",
    currentTool: "calendar.search",
    messageCount: 4,
    activity: "active",
    createdAt: "2026-11-07T08:00:00Z",
    updatedAt: "2026-11-07T08:58:00Z",
  },
  {
    id: "cnv_wait",
    agentId: "ag_miso",
    title: "Lunch with Joon",
    status: "active",
    lastMessagePreview: "Which day suits you?",
    lastRunStatus: "completed",
    awaitingInput: true,
    messageCount: 6,
    activity: "waiting",
    createdAt: "2026-11-07T06:00:00Z",
    updatedAt: "2026-11-07T07:00:00Z",
  },
  {
    id: "cnv_fail",
    agentId: "ag_ria",
    title: "Refund for order 1182",
    status: "active",
    lastRunStatus: "failed",
    lastRunErrorCode: "MODEL_UNAVAILABLE",
    messageCount: 2,
    activity: "failed",
    createdAt: "2026-11-06T11:00:00Z",
    updatedAt: "2026-11-06T12:00:00Z",
  },
  {
    id: "cnv_done",
    agentId: "ag_miso",
    title: "Weekly report",
    status: "active",
    lastMessagePreview: "Sent to the team.",
    lastRunStatus: "completed",
    messageCount: 9,
    activity: "done",
    createdAt: "2026-10-30T11:00:00Z",
    updatedAt: "2026-10-30T12:00:00Z",
  },
];

/** studio.agents.facets' answer for Miso (StudioAgentsFacetsResult), its connectors out of reach. */
export const misoFacets = () => ({
  agent: endueAgents()[0],
  identity: { name: "Miso", role: "Keeps my calendar", languages: ["en", "ko"] },
  settings: {
    visibility: "private",
    chatHistoryRetention: 90,
    model: { default: "anthropic/claude-sonnet-4.5", routing: "balanced" },
    disabledToolGroups: [],
  },
  prompt: {
    rev: 3,
    content: "Answer briefly.",
    source: "manual",
    createdAt: "2026-11-01T09:00:00Z",
  },
  revisions: [
    {
      rev: 3,
      source: "manual",
      preview: "Answer briefly.",
      createdAt: "2026-11-01T09:00:00Z",
      active: true,
    },
    {
      rev: 2,
      source: "manual",
      preview: "Be kind.",
      createdAt: "2026-10-20T09:00:00Z",
      active: false,
    },
  ],
  skills: [
    { id: "asb_1", skillId: "sk_1", slug: "mail-triage", name: "Mail triage", enabled: true },
  ],
  connectors: [],
  traits: [{ key: "self_evolving", enabled: true }],
  problems: [
    { facet: "connectors", code: "offline", message: "endue AI did not answer within 15 s." },
  ],
});

const both = (en: string, ko: string) => ({ en, ko });

/** studio.catalog.list's agents (StudioCatalogAgent). */
export const catalog = () => [
  {
    id: "cat_mail",
    slug: "mail-helper",
    category: "support",
    tags: ["mail"],
    featured: true,
    publisher: { kind: "official", name: "endue" },
    version: 3,
    name: "Mailie",
    role: both("Support mail", "고객 메일"),
    tagline: both("Answers support mail", "고객 문의 메일에 답해요"),
    description: both("Reads and answers.", "읽고 답해요."),
    strengths: [
      both("Polite", "공손해요"),
      both("Fast", "빨라요"),
      both("Your tone", "말투"),
      both("Fourth", "넷째"),
    ],
    useCases: [],
    connectors: [{ type: "gmail", required: true }],
    channels: ["web", "slack"],
    preset: { traits: [], skills: [] },
  },
  {
    id: "cat_plan",
    slug: "planner",
    category: "productivity",
    tags: [],
    featured: false,
    publisher: { kind: "official", name: "endue" },
    version: 1,
    name: "Planner",
    role: both("Keeps the calendar", "일정 관리"),
    tagline: both("Finds the time", "시간을 찾아요"),
    description: both("Plans your week.", "한 주를 계획해요."),
    strengths: [both("Calm", "차분해요")],
    useCases: [],
    connectors: [],
    channels: ["web"],
    preset: { traits: [], skills: [] },
  },
];
