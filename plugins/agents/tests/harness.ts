// Mounts endue.agents' controller on the SDK's test host: agents.* answered from the fixtures as
// desk-core answers them, studio.* as the core's platform client answers them, and a view that
// records every model it was asked to draw. The SDK is imported by its workspace path.
import { StubError } from "../../../packages/bridge/src/index";
import { defineUiPlugin } from "../../../packages/plugin-sdk/src/index";
import { createTestHost, type TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { type App, createApp, type Shown } from "../ui/app.js";
import {
  catalog,
  endueAgents,
  endueConversations,
  localAgents,
  localSessions,
  misoFacets,
  NOW,
  run,
  transcript,
} from "./fixtures";

export type Handlers = NonNullable<Parameters<typeof createTestHost>[0]["handlers"]>;
/** What studio.* calls carry, loosely: the namespace is #547's (specs/bridge/v0/studio.schema.json). */
export type StudioParams = Partial<
  Record<"agentId" | "slug" | "query" | "locale" | "status", string>
> &
  Partial<Record<"running" | "awaitingInput", boolean>>;
export type StudioHandlers = Record<string, (params: StudioParams) => unknown>;

/** agents.* over the fixtures; agents.ask starts run-7 and agents.stop stops it. */
export function localHandlers(over: Handlers = {}): Handlers {
  const sessions = localSessions();
  return {
    "agents.list": () => ({ agents: localAgents() }),
    "agents.runs": () => ({ runs: [] }),
    "agents.sessions": ({ agent, limit = 50 }) => {
      const all = sessions[agent] ?? [];
      return { sessions: all.slice(0, limit), total: all.length };
    },
    "agents.transcript": ({ agent, sessionId }) => {
      const session = (sessions[agent] ?? []).find((s) => s.id === sessionId);
      if (!session) throw new StubError("not_found", "no such session");
      return { session, messages: transcript(), truncated: false };
    },
    "agents.ask": (params) => ({
      run: run({
        prompt: params.prompt,
        access: params.access ?? "read-only",
        ...(params.sessionId ? { sessionId: params.sessionId } : {}),
      }),
    }),
    "agents.stop": () => ({ run: run({ state: "stopped", endedAt: "2026-11-07T09:00:30.000Z" }) }),
    ...over,
  };
}

/** studio.* over the fixtures, as #547's core answers it (specs/bridge/v0/studio.schema.json). */
export function studioHandlers(over: StudioHandlers = {}): StudioHandlers {
  const agents: Array<Record<string, unknown>> = endueAgents();
  const fresh = {
    id: "ag_new",
    slug: "joon",
    name: "Joon",
    status: "active",
    createdAt: "2026-11-07T09:00:00Z",
    updatedAt: "2026-11-07T09:00:00Z",
  };
  const created = () => {
    if (!agents.some((a) => a.id === fresh.id)) agents.unshift(fresh);
    return fresh;
  };
  const find = (agentId: string | undefined) => {
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) throw new StubError("not_found", "no such agent");
    return agent;
  };
  return {
    "studio.agents.list": () => ({ agents }),
    "studio.conversations.list": ({ running, awaitingInput }) => {
      const all = endueConversations().filter(
        (c) => (!running || c.lastRunStatus === "running") && (!awaitingInput || c.awaitingInput),
      );
      return { conversations: all, total: all.length, hasMore: false };
    },
    "studio.agents.facets": ({ agentId }) => {
      const agent = find(agentId);
      if (agentId === "ag_miso") return misoFacets();
      return {
        agent,
        identity: { name: agent.name, role: "", languages: ["en"] },
        revisions: [],
        skills: [],
        connectors: [],
        traits: [],
        problems: [],
      };
    },
    "studio.agents.update": ({ agentId }) => ({ agent: find(agentId) }),
    "studio.agents.setStatus": ({ agentId, status }) => ({ agent: { ...find(agentId), status } }),
    "studio.agents.prompt.update": () => ({
      prompt: { rev: 4, content: "x", source: "manual", createdAt: "2026-11-07T09:00:00Z" },
    }),
    "studio.agents.remove": ({ agentId }) => {
      find(agentId);
      agents.splice(
        agents.findIndex((a) => a.id === agentId),
        1,
      );
      return { agentId };
    },
    "studio.agents.create": () => ({ agent: created(), warnings: [] }),
    "studio.catalog.list": () => ({ agents: catalog() }),
    "studio.catalog.recommend": () => ({
      matches: [
        { slug: "mail-helper", reason: "It answers mail" },
        { slug: "gone-from-the-catalog", reason: "Not published any more" },
      ],
      source: "llm",
    }),
    "studio.catalog.use": () => ({
      agent: created(),
      catalog: { id: "cat_mail", slug: "mail-helper", version: 3 },
      applied: { prompt: true, traits: [], skills: [], model: false },
      warnings: [{ step: "model", code: "MODEL_NOT_ALLOWED" }],
      recommended: { connectors: [{ type: "gmail", required: true }], channels: [] },
    }),
    ...over,
  };
}

type Part<K extends "home" | "studio" | "create"> = NonNullable<Shown[K]>;

export interface Mounted {
  host: TestHost;
  app: App;
  shown: Shown[];
  asked: string[];
  approvals: Array<{ prompt: string; folder: string; agent: string }>;
  last(): Shown;
  /** The page on screen now, which must be the one named. */
  home(): Part<"home">;
  studio(): Part<"studio">;
  create(): Part<"create">;
  chat(): NonNullable<Part<"studio">["chat"]>;
  methods(prefix: string): string[];
  params(method: string): unknown[];
}

/** The controller on the test host; `answer` is the person's answer to every question. */
export async function mount(
  options: { local?: Handlers; studio?: StudioHandlers; answer?: boolean } = {},
): Promise<Mounted> {
  const handlers = { ...localHandlers(options.local), ...studioHandlers(options.studio) };
  const host = createTestHost({ pluginId: "endue.agents", handlers: handlers as Handlers });
  const shown: Shown[] = [];
  const asked: string[] = [];
  const approvals: Mounted["approvals"] = [];
  let app: App | undefined;
  await defineUiPlugin(
    {
      async mount(ctx) {
        app = createApp(
          ctx,
          { show: (s) => shown.push(s) },
          {
            now: () => NOW,
            confirm: async (question: string) => {
              asked.push(question);
              return options.answer ?? true;
            },
            approve: async (question) => {
              approvals.push(question);
              return options.answer ?? true;
            },
          },
        );
        await app.ready;
      },
    },
    host.transport,
  );
  await host.settle();
  if (!app) throw new Error("endue.agents did not mount");
  const last = () => {
    const latest = shown.at(-1);
    if (!latest) throw new Error("nothing shown yet");
    return latest;
  };
  const part = <K extends "home" | "studio" | "create">(key: K): Part<K> => {
    const value = last()[key];
    if (!value) throw new Error(`the page on screen is ${last().route.page}, not ${key}`);
    return value as Part<K>;
  };
  return {
    host,
    app,
    shown,
    asked,
    approvals,
    last,
    home: () => part("home"),
    studio: () => part("studio"),
    create: () => part("create"),
    chat: () => {
      const chat = part("studio").chat;
      if (!chat) throw new Error("no chat on screen");
      return chat;
    },
    methods: (prefix) => host.calls.map((c) => c.method).filter((m) => m.startsWith(prefix)),
    params: (method) => host.calls.filter((c) => c.method === method).map((c) => c.params),
  };
}

/** Let every answer and redraw land. */
export const settle = async (host: TestHost) => {
  for (let i = 0; i < 3; i++) {
    await host.settle();
    await new Promise((done) => setTimeout(done, 0));
  }
};

/** The item at `at`, which the fixture has. */
export function pick<T>(items: readonly T[], at = 0): T {
  const item = items[at];
  if (item === undefined) throw new Error(`no item ${at}`);
  return item;
}
