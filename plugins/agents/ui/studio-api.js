// The endue side's one door to the core: studio.* (specs/bridge/v0/studio.schema.json, ADR 0122),
// the person's endue AI agents through the platform API, under studio:manage. Every method name and
// shape the plugin depends on is here, so a rename touches this file only. A desk that does not
// serve studio.* (unsupported) makes the endue side unavailable, one that is not signed in to endue
// ID (signed_out) signed out, and endue AI out of reach (offline) offline; none is an error.

/** The scope every studio.* call carries. */
export const STUDIO = /** @type {const} */ ({ permission: "studio:manage" });

/**
 * @typedef {{ call(method: string, params: unknown): Promise<any> }} Bridge
 * @typedef {object} EndueAgent
 * @property {string} id
 * @property {string} slug
 * @property {string} name
 * @property {"active" | "inactive" | "archived" | "deleted"} status
 * @property {string} [avatarUrl]
 * @property {string} [role]       read with the agent's facets; the list has none
 * @property {string} [updatedAt]
 * @typedef {object} EndueConversation
 * @property {string} id
 * @property {string} agentId
 * @property {string} title
 * @property {string} preview
 * @property {"waiting" | "active" | "failed" | "done"} activity  its Home board column, as the core sorts it
 * @property {boolean} running
 * @property {boolean} awaitingInput
 * @property {string} [currentTool]
 * @property {string} [errorCode]
 * @property {number} messageCount
 * @property {string} updatedAt
 * @typedef {object} EndueDetail
 * @property {EndueAgent} agent
 * @property {import("@endue-ai/bridge").StudioIdentity} [identity]
 * @property {import("@endue-ai/bridge").StudioSettings} [settings]
 * @property {import("@endue-ai/bridge").StudioPrompt} [prompt]
 * @property {import("@endue-ai/bridge").StudioPromptRevision[]} revisions
 * @property {import("@endue-ai/bridge").StudioSkill[]} skills
 * @property {import("@endue-ai/bridge").StudioConnector[]} connectors
 * @property {import("@endue-ai/bridge").StudioTrait[]} traits
 * @property {import("@endue-ai/bridge").StudioFacetProblem[]} problems
 * @typedef {object} CatalogAgent
 * @property {string} slug
 * @property {string} name
 * @property {string} role
 * @property {string} tagline
 * @property {string} description
 * @property {string[]} strengths   the first three
 * @property {string} category
 * @property {boolean} featured
 * @property {string} publisher
 * @property {string} [avatarUrl]
 * @property {{ type: string, required: boolean }[]} connectors
 * @property {string[]} channels
 * @property {string} [reason]      why a search found it: model output, shown as text only
 * @typedef {"unavailable" | "signed-out" | "offline" | "forbidden" | "denied" | "missing" | "failed"} StudioProblem
 */

/** A failed studio.* call, said for people, with what kind of failure it was. */
export class StudioError extends Error {
  /** @param {string} message @param {StudioProblem} kind */
  constructor(message, kind) {
    super(message);
    this.name = "StudioError";
    this.kind = kind;
  }
}

const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";
const whyOf = (/** @type {unknown} */ error) =>
  (error instanceof Error ? error.message : String(error)).replace(/^[a-z.]+: [a-z_]+: /, "");

/** The core's error code, as the endue side tells it. */
export function studioError(/** @type {unknown} */ error) {
  const why = whyOf(error);
  switch (codeOf(error)) {
    case "signed_out":
      return new StudioError("Sign in to see your endue agents.", "signed-out");
    case "offline":
      return new StudioError(why || "endue AI is out of reach right now.", "offline");
    case "forbidden":
      return new StudioError(why || "endue AI refused that.", "forbidden");
    case "unsupported":
      return new StudioError("This desk does not reach endue agents yet.", "unavailable");
    case "permission_denied":
      return new StudioError("Not allowed to manage your endue agents.", "denied");
    case "not_found":
      return new StudioError(why || "That is not there any more.", "missing");
    default:
      return new StudioError(why || codeOf(error), "failed");
  }
}

const text = (/** @type {unknown} */ value) => (typeof value === "string" ? value : "");
const list = (/** @type {unknown} */ value) => (Array.isArray(value) ? value : []);
/** Catalog text in the person's language, else English. */
const local = (/** @type {any} */ value, /** @type {string} */ locale) =>
  typeof value === "string" ? value : text(value?.[locale.slice(0, 2)]) || text(value?.en);

/** An agent as studio.* answers it, in the plugin's shape. @returns {EndueAgent} */
export const agentOf = (/** @type {any} */ a) => ({
  id: text(a.id),
  slug: text(a.slug),
  name: text(a.name) || text(a.slug),
  status: ["inactive", "archived", "deleted"].includes(a.status) ? a.status : "active",
  ...(a.avatarUrl ? { avatarUrl: a.avatarUrl } : {}),
  ...(a.role ? { role: a.role } : {}),
  ...(a.updatedAt ? { updatedAt: a.updatedAt } : {}),
});

const ACTIVITY = new Set(["waiting", "active", "failed", "done"]);

/** A conversation as studio.* answers it, in the plugin's shape. @returns {EndueConversation} */
export const conversationOf = (/** @type {any} */ c) => ({
  id: text(c.id),
  agentId: text(c.agentId),
  title: text(c.title),
  preview: text(c.lastMessagePreview),
  activity: ACTIVITY.has(c.activity) ? c.activity : "done",
  running: c.lastRunStatus === "running",
  awaitingInput: c.awaitingInput === true,
  ...(c.currentTool ? { currentTool: c.currentTool } : {}),
  ...(c.lastRunErrorCode ? { errorCode: c.lastRunErrorCode } : {}),
  messageCount: typeof c.messageCount === "number" ? c.messageCount : 0,
  updatedAt: text(c.updatedAt) || text(c.lastMessageAt) || text(c.createdAt),
});

/** A catalog agent as studio.* answers it, in the person's language. @returns {CatalogAgent} */
export const catalogOf = (/** @type {any} */ c, /** @type {string} */ locale = "en") => ({
  slug: text(c.slug),
  name: text(c.name),
  role: local(c.role, locale),
  tagline: local(c.tagline, locale),
  description: local(c.description, locale),
  strengths: list(c.strengths)
    .map((s) => local(s, locale))
    .filter(Boolean)
    .slice(0, 3),
  category: text(c.category),
  featured: c.featured === true,
  publisher: text(c.publisher?.name),
  ...(c.avatarUrl ? { avatarUrl: c.avatarUrl } : {}),
  connectors: list(c.connectors).map((k) => ({
    type: text(k.type),
    required: k.required === true,
  })),
  channels: list(c.channels).map(text),
});

/** A warning of create or use, for people. */
const warningOf = (/** @type {any} */ w) =>
  `${text(w.step) || "setup"}: ${text(w.code)}${w.target ? ` (${w.target})` : ""}`;

/** @param {{ bridge: Bridge }} ctx */
export function createStudioApi({ bridge }) {
  const call = async (/** @type {string} */ method, /** @type {object} */ params = {}) => {
    try {
      return await bridge.call(method, { ...params, scope: STUDIO });
    } catch (error) {
      throw studioError(error);
    }
  };
  /** @type {Map<string, CatalogAgent[]>} the catalog by locale, read once */
  const catalogs = new Map();
  const catalog = async (/** @type {string} */ locale = "en") => {
    const answer = await call("studio.catalog.list", { limit: 100 });
    const agents = list(answer.agents).map((c) => catalogOf(c, locale));
    catalogs.set(locale, agents);
    return agents;
  };
  /** One page of conversations; the board reads the newest and every running or waiting one. */
  const page = async (/** @type {object} */ filter) =>
    list((await call("studio.conversations.list", { limit: 50, ...filter })).conversations);

  return {
    /** The person's agents, the newest first. @returns {Promise<EndueAgent[]>} */
    agents: async () => list((await call("studio.agents.list")).agents).map(agentOf),
    /** The latest conversations, with every one running or waiting, newest first. */
    conversations: async () => {
      const pages = await Promise.all([
        page({}),
        page({ running: true }).catch(() => []),
        page({ awaitingInput: true }).catch(() => []),
      ]);
      /** @type {Map<string, EndueConversation>} */
      const byId = new Map();
      for (const c of pages.flat().map(conversationOf)) {
        const known = byId.get(c.id);
        if (!known || Date.parse(c.updatedAt) > Date.parse(known.updatedAt)) byId.set(c.id, c);
      }
      return [...byId.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    },
    /** Everything Studio shows of one agent; a facet endue AI did not answer is in problems. */
    detail: async (/** @type {string} */ agentId) => {
      const got = await call("studio.agents.facets", { agentId });
      /** @type {EndueDetail} */
      const detail = {
        agent: agentOf({ ...got.agent, role: got.identity?.role }),
        ...(got.identity ? { identity: got.identity } : {}),
        ...(got.settings ? { settings: got.settings } : {}),
        ...(got.prompt ? { prompt: got.prompt } : {}),
        revisions: list(got.revisions),
        skills: list(got.skills),
        connectors: list(got.connectors),
        traits: list(got.traits),
        problems: list(got.problems),
      };
      return detail;
    },
    /** Build an agent from scratch. @returns {Promise<{ agentId: string, warnings: string[] }>} */
    create: async (/** @type {{ name: string, role: string, locale: string }} */ fields) => {
      const answer = await call("studio.agents.create", {
        name: fields.name,
        role: fields.role,
        languages: [fields.locale.slice(0, 2)],
      });
      return { agentId: text(answer.agent?.id), warnings: list(answer.warnings).map(warningOf) };
    },
    /** Change its identity or settings: only the fields given. */
    update: (
      /** @type {string} */ agentId,
      /** @type {{ name?: string, role?: string, description?: string, languages?: string[], visibility?: string, model?: string }} */ change,
    ) => call("studio.agents.update", { agentId, ...change }),
    /** Keep new instructions as the revision in force. */
    setPrompt: (/** @type {string} */ agentId, /** @type {string} */ content) =>
      call("studio.agents.prompt.update", { agentId, content }),
    /** Put an earlier revision back in force. */
    restorePrompt: (/** @type {string} */ agentId, /** @type {number} */ rev) =>
      call("studio.agents.prompt.update", { agentId, restore: rev }),
    /** Enable or disable it. */
    setStatus: (/** @type {string} */ agentId, /** @type {"active" | "inactive"} */ status) =>
      call("studio.agents.setStatus", { agentId, status }),
    /** Delete it (endue AI keeps it 30 days). */
    remove: (/** @type {string} */ agentId) => call("studio.agents.remove", { agentId }),
    /** Every published catalog agent, featured first. @returns {Promise<CatalogAgent[]>} */
    catalog,
    /**
     * Catalog agents for what the person wants done, the best first, each with why.
     * @returns {Promise<{ matches: CatalogAgent[], source: "llm" | "keyword" }>}
     */
    recommend: async (/** @type {string} */ query, /** @type {string} */ locale) => {
      const [answer, known] = await Promise.all([
        call("studio.catalog.recommend", { query, locale }),
        catalogs.get(locale) ?? catalog(locale).catch(() => []),
      ]);
      const bySlug = new Map(known.map((c) => [c.slug, c]));
      const matches = list(answer.matches).flatMap((m) => {
        const found = bySlug.get(text(m.slug));
        return found ? [{ ...found, reason: text(m.reason) }] : [];
      });
      return { matches, source: answer.source === "llm" ? "llm" : "keyword" };
    },
    /** Start an agent from a catalog agent. @returns {Promise<{ agentId: string, warnings: string[] }>} */
    use: async (/** @type {string} */ slug, /** @type {string} */ locale) => {
      const answer = await call("studio.catalog.use", { slug, locale });
      return { agentId: text(answer.agent?.id), warnings: list(answer.warnings).map(warningOf) };
    },
  };
}

/** @typedef {ReturnType<typeof createStudioApi>} StudioApi */
