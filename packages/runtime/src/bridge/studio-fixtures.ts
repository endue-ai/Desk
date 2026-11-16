/**
 * The browser stub's studio.* samples (studio.ts): three agents of the person's, one per state, the
 * Home board's conversations in every column, and three published catalog agents.
 */
import type {
  StudioAgent,
  StudioAgentsFacetsResult,
  StudioCatalogAgent,
  StudioConversation,
  StudioIdentity,
  StudioPersonality,
  StudioPrompt,
  StudioSettings,
} from "@endue-ai/bridge";

/** The rows of Studio's board beyond its facets (ADR 0232). */
export type StudioRows = Pick<
  StudioAgentsFacetsResult,
  "channels" | "apiKeys" | "devices" | "memory" | "outputs" | "theme"
>;

/** One agent with what Studio shows of it. */
export interface StudioRecord {
  agent: StudioAgent;
  identity: StudioIdentity;
  settings: StudioSettings;
  revisions: StudioPrompt[];
  /** What the board reads beyond the facets; none for an agent with nothing of the kind. */
  rows?: StudioRows;
}

/** What endue AI answers for an agent with no channel, key or device, nothing kept or made. */
export const EMPTY_ROWS: StudioRows = {
  channels: [],
  apiKeys: [],
  devices: [],
  memory: { memories: 0, rules: 0, more: false },
  outputs: { count: 0 },
  theme: {},
};

/** endue.ai's defaults for an agent built from scratch. */
export const DEFAULT_PERSONALITY: StudioPersonality = {
  tone: 0.7,
  agency: 0.3,
  thinking: 0.2,
  rigor: 0.85,
  expression: 0.7,
  humor: 0.15,
  integrity: 0.85,
  epistemicHumility: 0.65,
};

export const slugOf = (name: string, n: number) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || `agent-${n}`;

const iso = (epoch: number, minutesAgo: number) =>
  new Date(epoch - minutesAgo * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
/** The id of sample agent `n`: 1 Miso, 2 Mailie, 3 Scout. */
/** A sample face as the core hands one over (ADR 0232): a robot on `colour`, as a data: URL. */
export function sampleFace(colour: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${colour}"/>` +
    `<rect x="8" y="12" width="5" height="5" rx="1"/><rect x="19" y="12" width="5" height="5" rx="1"/>` +
    `<rect x="11" y="22" width="10" height="2" rx="1"/></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

export const sampleAgentId = (n: number) => `ag_sample${String(n).padStart(19, "0")}`;
const AG = sampleAgentId;
const both = (en: string, ko: string) => ({ en, ko });

/** Three agents: Miso (active, with a prompt), Mailie (from the catalog, turned off), Scout. */
export function sampleStudio(epoch: number): StudioRecord[] {
  const record = (
    n: number,
    name: string,
    role: string,
    extra: Partial<StudioAgent>,
  ): StudioRecord => ({
    agent: {
      id: AG(n),
      slug: slugOf(name, n),
      name,
      status: "active",
      createdAt: iso(epoch, 60 * 24 * (10 - n)),
      updatedAt: iso(epoch, 60 * n),
      ...extra,
    },
    identity: { name, role, languages: ["ko", "en"], personality: { ...DEFAULT_PERSONALITY } },
    settings: {
      visibility: "private",
      model: {},
      disabledToolGroups: [],
      availableToolGroups: ["browser", "workspace"],
    },
    revisions: [],
  });
  const miso = record(1, "Miso", "Keeps my calendar and sorts my mail", {
    personalColor: "#B6A3F5",
  });
  miso.revisions.push({
    rev: 1,
    content: "Answer briefly, in Korean.",
    source: "manual",
    createdAt: iso(epoch, 90),
  });
  miso.settings.model = { default: "anthropic/claude-sonnet-4.5", routing: "balanced" };
  miso.rows = {
    channels: [
      {
        id: "cp_sample1",
        provider: "slack",
        name: "Acme",
        status: "active",
        lastActiveAt: iso(epoch, 30),
      },
    ],
    apiKeys: [{ id: "key_sample1", name: "Calendar sync", createdAt: iso(epoch, 60 * 24 * 3) }],
    devices: [{ id: "dev_sample1", kind: "computer", name: "MacBook", workspace: false }],
    memory: { memories: 12, rules: 3, more: false },
    outputs: { count: 4, latestAt: iso(epoch, 45) },
    theme: { wallpaper: { source: "builtin", id: "constellation" } },
  };
  const mailie = record(2, "Mailie", "Answers customer mail", {
    status: "inactive",
    personalColor: "#7FB3D5",
    avatarUrl: "https://cdn.endue.ai/c/mailie.png",
    sourceCatalog: { catalogAgentId: "cat_support_mail", version: 3 },
  });
  const scout = record(3, "Scout", "Researches markets and sums them up", {
    personalColor: "#F5B7A3",
  });
  return [miso, mailie, scout];
}

/** One conversation in each column of the Home board, and one more for Miso. */
export function sampleConversations(epoch: number): StudioConversation[] {
  const row = (
    n: number,
    agent: number,
    title: string,
    minutesAgo: number,
    extra: Partial<StudioConversation>,
  ): StudioConversation => ({
    id: `cnv_sample${n}`,
    agentId: AG(agent),
    title,
    status: "active",
    messageCount: 2 + n,
    lastMessageAt: iso(epoch, minutesAgo),
    activity: "done",
    createdAt: iso(epoch, minutesAgo + 30),
    updatedAt: iso(epoch, minutesAgo),
    ...extra,
  });
  return [
    row(1, 1, "Move Friday's dentist", 2, {
      lastRunStatus: "running",
      currentTool: "calendar__update_event",
      activity: "active",
    }),
    row(2, 2, "Refund for order 42", 5, {
      lastRunStatus: "completed",
      awaitingInput: true,
      lastMessagePreview: "Shall I send it?",
      activity: "waiting",
    }),
    row(3, 3, "Battery market, Q3", 40, {
      lastRunStatus: "failed",
      lastRunErrorCode: "LLM_TIMEOUT",
      activity: "failed",
    }),
    row(4, 1, "Sort this week's mail", 180, {
      lastRunStatus: "completed",
      lastMessagePreview: "Done: 12 archived, 3 starred.",
      activity: "done",
    }),
  ];
}

/** Three published catalog agents. */
export function sampleCatalog(epoch: number): StudioCatalogAgent[] {
  const agent = (
    slug: string,
    name: string,
    category: string,
    tags: string[],
    role: [string, string],
    tagline: [string, string],
    connectors: string[],
  ): StudioCatalogAgent => ({
    id: `cat_${slug.replace(/-/g, "_")}`,
    slug,
    category,
    tags,
    featured: slug === "support-mail",
    publisher: { kind: "official", name: "endue" },
    version: 3,
    name,
    role: both(...role),
    tagline: both(...tagline),
    description: both(`${name} ${tagline[0].toLowerCase()}.`, `${tagline[1]}.`),
    strengths: [both("Fast", "빨라요"), both("Careful", "꼼꼼해요")],
    useCases: [
      {
        title: both(role[0], role[1]),
        example: both(`Help me: ${tagline[0]}`, `${tagline[1]} 도와줘`),
      },
    ],
    connectors: connectors.map((type, i) => ({ type, required: i === 0 })),
    channels: ["web", "slack"],
    preset: {
      traits: ["personality"],
      skills: [`${tags[0]}-triage`],
      model: "anthropic/claude-sonnet-4.5",
    },
    publishedAt: iso(epoch, 60 * 24 * 30),
  });
  return [
    agent(
      "support-mail",
      "Mailie",
      "support",
      ["mail", "support"],
      ["Support mail", "고객 메일"],
      ["Answers support mail", "고객 문의 메일에 답해요"],
      ["gmail"],
    ),
    agent(
      "calendar-keeper",
      "Kairos",
      "productivity",
      ["calendar", "schedule"],
      ["Calendar keeper", "일정 관리"],
      ["Keeps your calendar tidy", "일정을 정리해요"],
      ["google_calendar"],
    ),
    agent(
      "market-scout",
      "Scout",
      "research",
      ["research", "market"],
      ["Market research", "시장 조사"],
      ["Sums up a market", "시장을 요약해요"],
      ["notion", "slack"],
    ),
  ];
}
