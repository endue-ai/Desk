/**
 * studio.* on the browser stub (the fixtures and the dev page; never shipped): the person's endue
 * AI agents kept in memory as desk-core keeps them on endue AI's platform (ADR 0122), so runtime e2e
 * can draw the agent cards. Agents are created, changed, turned off and on and deleted; facets,
 * prompt revisions, the catalog and the Home board's conversations answer in the bridge's shapes.
 * Signed out every call is `signed_out`; a caller without studio:manage is `permission_denied`.
 * Mount it with `browserCore({ handlers: { ...studioHandlers().handlers } })`.
 */
import {
  type Permission,
  StubError,
  type StubHandlers,
  type StudioAgent,
  type StudioCatalogAgent,
  type StudioConversation,
  type StudioPrompt,
} from "@endue-ai/bridge";
import {
  DEFAULT_PERSONALITY,
  type StudioRecord,
  sampleCatalog,
  sampleConversations,
  sampleStudio,
  slugOf,
} from "./studio-fixtures";

export { DEFAULT_PERSONALITY, type StudioRecord } from "./studio-fixtures";

export interface StudioStubOptions {
  /** Start signed in (the default) or signed out. */
  signedIn?: boolean;
  /** Start with the sample agents (the default) or none. */
  agents?: boolean;
  /** Wall-clock time the sample timestamps are relative to (default: now). */
  epoch?: number;
  /** Each caller's grants, as the core holds them; without it every caller holds studio:manage. */
  grants?: Record<string, Permission[]>;
}

export interface StudioStub {
  handlers: StubHandlers;
  /** The agents in memory, deleted ones too; tests edit them in place. */
  records: StudioRecord[];
  conversations: StudioConversation[];
  catalog: StudioCatalogAgent[];
  /** Sign the stub in or out, as account.signIn and account.signOut would. */
  setSignedIn(signedIn: boolean): void;
}

const SIGN_IN = "Sign in to endue to manage your agents.";
const MANAGE: Permission = { permission: "studio:manage" };
const copy = <T>(value: T): T => structuredClone(value);

export function studioHandlers(options: StudioStubOptions = {}): StudioStub {
  const epoch = options.epoch ?? Date.now();
  let signedIn = options.signedIn ?? true;
  let clock = 0;
  const now = () => new Date(epoch + ++clock * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const records: StudioRecord[] = options.agents === false ? [] : sampleStudio(epoch);
  const conversations = options.agents === false ? [] : sampleConversations(epoch);
  const catalog = sampleCatalog(epoch);

  /** The checks every call passes, as the core makes them. */
  const gate = (caller: string | undefined) => {
    const held =
      caller === undefined ||
      !options.grants ||
      (options.grants[caller] ?? []).some((p) => p.permission === "studio:manage");
    if (!held) throw new StubError("permission_denied", "no grant covers the scope", MANAGE);
    if (!signedIn) throw new StubError("signed_out", SIGN_IN);
  };
  const find = (agentId: string) => {
    const record = records.find((r) => r.agent.id === agentId && r.agent.status !== "deleted");
    if (!record) throw new StubError("not_found", "Agent not found");
    return record;
  };
  const touch = (record: StudioRecord) => {
    record.agent.updatedAt = now();
  };
  const words = (text: string, what: string, max: number) => {
    const trimmed = text.trim();
    if (!trimmed || [...trimmed].length > max)
      throw new StubError("invalid_params", `${what} must be 1 to ${max} characters`);
    return trimmed;
  };
  const add = (name: string, role: string, extra: Partial<StudioAgent> = {}): StudioRecord => {
    const at = now();
    const n = records.length + 1;
    const record: StudioRecord = {
      agent: {
        id: `ag_stub${String(n).padStart(20, "0")}`,
        slug: slugOf(name, n),
        name,
        status: "active",
        personalColor: "#B6A3F5",
        createdAt: at,
        updatedAt: at,
        ...extra,
      },
      identity: { name, role, languages: ["en"], personality: { ...DEFAULT_PERSONALITY } },
      settings: {
        visibility: "private",
        model: {},
        disabledToolGroups: [],
        availableToolGroups: ["browser", "workspace"],
      },
      revisions: [],
    };
    records.unshift(record);
    return record;
  };
  const revise = (
    record: StudioRecord,
    content: string,
    restoredFromRev?: number,
  ): StudioPrompt => {
    const prompt: StudioPrompt = {
      rev: record.revisions.length + 1,
      content,
      source: restoredFromRev ? "restore" : "manual",
      ...(restoredFromRev ? { restoredFromRev } : {}),
      createdAt: now(),
    };
    record.revisions.push(prompt);
    touch(record);
    return copy(prompt);
  };

  const handlers: StubHandlers = {
    "studio.agents.list": (_params, caller) => {
      gate(caller);
      return {
        agents: records.filter((r) => r.agent.status !== "deleted").map((r) => copy(r.agent)),
      };
    },
    "studio.agents.get": ({ agentId }, caller) => {
      gate(caller);
      return { agent: copy(find(agentId).agent) };
    },
    "studio.agents.create": (
      { name, role, description, languages, personality, model },
      caller,
    ) => {
      gate(caller);
      const record = add(words(name, "name", 100), words(role, "role", 2000));
      if (description) record.identity.description = description;
      if (languages?.length) record.identity.languages = [...languages];
      if (personality) record.identity.personality = { ...personality };
      if (model) record.settings.model = { default: model };
      return { agent: copy(record.agent), warnings: [] };
    },
    "studio.agents.update": (params, caller) => {
      gate(caller);
      const record = find(params.agentId);
      const { name, role, description, languages, personality, personalColor, model, visibility } =
        params;
      if (
        [name, role, description, languages, personality, personalColor, model, visibility].every(
          (v) => v === undefined,
        )
      )
        throw new StubError("invalid_params", "studio.agents.update changes at least one field");
      if (name !== undefined) record.agent.name = record.identity.name = words(name, "name", 100);
      if (role !== undefined) record.identity.role = words(role, "role", 2000);
      if (description !== undefined) record.identity.description = description;
      if (languages?.length) record.identity.languages = [...languages];
      if (personality) record.identity.personality = { ...personality };
      if (personalColor) record.agent.personalColor = record.identity.personalColor = personalColor;
      if (model !== undefined)
        record.settings.model = model ? { ...record.settings.model, default: model } : {};
      if (visibility) record.settings.visibility = visibility;
      touch(record);
      return { agent: copy(record.agent) };
    },
    "studio.agents.setStatus": ({ agentId, status }, caller) => {
      gate(caller);
      const record = find(agentId);
      if (record.agent.status !== status) {
        record.agent.status = status;
        touch(record);
      }
      return { agent: copy(record.agent) };
    },
    "studio.agents.remove": ({ agentId }, caller) => {
      gate(caller);
      const record = find(agentId);
      record.agent.status = "deleted";
      touch(record);
      return { agentId };
    },
    "studio.agents.facets": ({ agentId }, caller) => {
      gate(caller);
      const record = find(agentId);
      const active = record.revisions.at(-1);
      return {
        agent: copy(record.agent),
        identity: copy(record.identity),
        settings: copy(record.settings),
        ...(active ? { prompt: copy(active) } : {}),
        revisions: record.revisions
          .slice(-50)
          .reverse()
          .map(({ rev, source, restoredFromRev, content, createdAt }) => ({
            rev,
            source,
            ...(restoredFromRev ? { restoredFromRev } : {}),
            preview: [...content].slice(0, 120).join(""),
            createdAt,
            active: rev === active?.rev,
          })),
        skills: [],
        connectors: [],
        traits: [{ key: "personality", enabled: true }],
        problems: [],
      };
    },
    "studio.agents.prompt.update": ({ agentId, content, restore }, caller) => {
      gate(caller);
      const record = find(agentId);
      if ((content === undefined) === (restore === undefined))
        throw new StubError(
          "invalid_params",
          "give the prompt's content or a revision to restore, not both",
        );
      if (content !== undefined) {
        words(content, "content", 20_000);
        return { prompt: revise(record, content) };
      }
      const earlier = record.revisions.find((r) => r.rev === restore);
      if (!earlier) throw new StubError("not_found", "Revision not found");
      return { prompt: revise(record, earlier.content, earlier.rev) };
    },
    "studio.catalog.list": ({ query, category, limit }, caller) => {
      gate(caller);
      const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const text = (a: StudioCatalogAgent) =>
        [a.name, a.tagline.en, a.tagline.ko, ...a.tags].join(" ").toLowerCase();
      const agents = catalog
        .filter((a) => !category || a.category === category)
        .filter((a) => words.every((w) => text(a).includes(w)))
        .slice(0, limit ?? 100);
      return { agents: copy(agents) };
    },
    "studio.catalog.recommend": ({ query }, caller) => {
      gate(caller);
      const asked = words(query, "query", 500).toLowerCase();
      const matches = catalog
        .filter((a) => a.tags.some((t) => asked.includes(t)))
        .map((a) => ({ slug: a.slug, reason: `${a.name} works with ${a.tags.join(", ")}.` }));
      return { matches, source: "keyword" };
    },
    "studio.catalog.use": ({ slug }, caller) => {
      gate(caller);
      const from = catalog.find((a) => a.slug === slug);
      if (!from) throw new StubError("not_found", "Catalog agent not found");
      const record = add(from.name, from.role.en, {
        sourceCatalog: { catalogAgentId: from.id, version: from.version },
        ...(from.avatarUrl ? { avatarUrl: from.avatarUrl } : {}),
      });
      revise(record, `You are ${from.name}. ${from.description.en}`);
      return {
        agent: copy(record.agent),
        catalog: { id: from.id, slug: from.slug, version: from.version },
        applied: {
          prompt: true,
          traits: [...from.preset.traits],
          skills: [...from.preset.skills],
          model: Boolean(from.preset.model),
        },
        warnings: [],
        recommended: { connectors: copy(from.connectors), channels: [...from.channels] },
      };
    },
    "studio.conversations.list": ({ agentId, awaitingInput, running, page, limit }, caller) => {
      gate(caller);
      const matching = conversations
        .filter((c) => !agentId || c.agentId === agentId)
        .filter((c) => !awaitingInput || c.awaitingInput === true)
        .filter((c) => !running || c.lastRunStatus === "running");
      const size = Math.min(Math.max(limit ?? 20, 1), 100);
      const at = (Math.max(page ?? 1, 1) - 1) * size;
      return {
        conversations: copy(matching.slice(at, at + size)),
        total: matching.length,
        hasMore: at + size < matching.length,
      };
    },
  };

  return {
    handlers,
    records,
    conversations,
    catalog,
    setSignedIn: (next) => {
      signedIn = next;
    },
  };
}
