// Mounts the memory inspector on the SDK's test host over a memory kept in an array, as desk-core
// keeps it: memory.* answered newest first, remember with an id edits, forget with all clears. The
// view records what it was asked to show. The SDK is imported by its workspace path.
import { type MemoryEntry, type MemoryFact, StubError } from "../../../packages/bridge/src/index";
import { defineUiPlugin } from "../../../packages/plugin-sdk/src/index";
import { createTestHost, type TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { createMemory, type Shown } from "../ui/controller.js";

type Handlers = NonNullable<Parameters<typeof createTestHost>[0]["handlers"]>;
export type Entry = MemoryEntry;

/** Fixture memory: two facts and a conversation, oldest first. */
export function fixture(): Entry[] {
  return [
    {
      kind: "fact",
      id: "fact_0001",
      text: "Reviews pull requests in the morning",
      by: "person",
      at: "2026-11-03T09:00:00.000Z",
      tags: ["work"],
    },
    {
      kind: "episode",
      id: "ep_0002",
      at: "2026-11-04T10:30:00.000Z",
      by: "eris",
      asked: "check my latest mail",
      answered: "You have 2 new messages. The newest is from Mina: Lunch today?",
      steps: [{ command: "endue.mail.latest", ok: true }],
    },
    {
      kind: "fact",
      id: "fact_0003",
      text: "Prefers pnpm over npm",
      by: "eris",
      at: "2026-11-05T08:00:00.000Z",
    },
  ];
}

/** memory.* over `entries`, which the handlers change in place. */
export function memoryHandlers(entries: Entry[]): Handlers {
  const newest = () => [...entries].reverse();
  const ofKind = (kind: string | undefined) =>
    newest().filter((e) => kind === undefined || e.kind === kind);
  let next = 100;
  return {
    "memory.list": ({ kind, limit = 50 }) => {
      const all = ofKind(kind);
      return { entries: all.slice(0, limit), ...(all.length > limit ? { next: "more" } : {}) };
    },
    "memory.search": ({ query, kind }) => {
      const words = query.toLowerCase().split(/\W+/).filter(Boolean);
      const text = (e: Entry) =>
        (e.kind === "fact" ? e.text : `${e.asked} ${e.answered}`).toLowerCase();
      const hits = ofKind(kind).filter((e) => words.some((w) => text(e).includes(w)));
      return { hits: hits.map((entry) => ({ entry, snippet: `[${words[0]}]` })) };
    },
    "memory.remember": ({ id, text }) => {
      if (id) {
        const fact = entries.find((e): e is MemoryFact => e.id === id && e.kind === "fact");
        if (!fact) throw new StubError("not_found", `no fact ${id}`);
        Object.assign(fact, { text, updated: "2026-11-05T12:00:00.000Z" });
        return { fact };
      }
      const fact: MemoryFact = {
        kind: "fact",
        id: `fact_${next++}`,
        text,
        by: "endue.memory",
        at: "2026-11-05T12:00:00.000Z",
      };
      entries.push(fact);
      return { fact };
    },
    "memory.forget": (params) => {
      const { id, all, kind } = params as { id?: string; all?: boolean; kind?: string };
      const before = entries.length;
      const keep = entries.filter((e) =>
        all ? kind !== undefined && e.kind !== kind : e.id !== id,
      );
      entries.splice(0, entries.length, ...keep);
      return { forgotten: before - entries.length };
    },
  };
}

export interface Mounted {
  host: TestHost;
  shown: Shown[];
  statuses: string[];
  asked: string[];
  app: ReturnType<typeof createMemory>;
  last(): Shown;
  methods(): string[];
}

/** The inspector on the test host; `answer` is the person's answer to every confirmation. */
export async function mount(
  entries = fixture(),
  answer = true,
  refuse: Parameters<typeof createTestHost>[0]["refuse"] = {},
): Promise<Mounted> {
  const host = createTestHost({
    pluginId: "endue.memory",
    handlers: memoryHandlers(entries),
    refuse,
  });
  const shown: Shown[] = [];
  const statuses: string[] = [];
  const asked: string[] = [];
  let app: ReturnType<typeof createMemory> | undefined;
  await defineUiPlugin(
    {
      async mount(ctx) {
        const view = { show: (s: Shown) => shown.push(s), status: (t: string) => statuses.push(t) };
        app = createMemory(ctx, view, async (question) => {
          asked.push(question);
          return answer;
        });
        await app.ready;
      },
    },
    host.transport,
  );
  await host.settle();
  if (!app) throw new Error("the inspector did not mount");
  return {
    host,
    shown,
    statuses,
    asked,
    app,
    last: () => {
      const latest = shown.at(-1);
      if (!latest) throw new Error("nothing shown yet");
      return latest;
    },
    methods: () => host.calls.map((call) => call.method).filter((m) => m.startsWith("memory.")),
  };
}
