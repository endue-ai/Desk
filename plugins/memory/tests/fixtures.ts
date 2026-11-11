// Fixture memory for endue.memory and memory.* over it, as desk-core answers them: newest first,
// remember with an id edits, forget with all clears the kind given (or everything). The unit tests'
// harness and the runtime e2e page (packages/runtime/e2e/fixture/memory.ts) share them.
import {
  type MemoryEntry,
  type MemoryFact,
  StubError,
  type StubHandlers,
} from "../../../packages/bridge/src/index";

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

/** A conversation of about 260 words asked and 120 answered, the newest entry. */
export function longEpisode(): Entry {
  const words = (n: number, word: string) => Array.from({ length: n }, () => word).join(" ");
  return {
    kind: "episode",
    id: "ep_0009",
    at: "2026-11-06T09:00:00.000Z",
    by: "eris",
    asked: `plan the week: ${words(258, "meeting")}`,
    answered: `Here is the plan. ${words(116, "review")}`,
  };
}

/** memory.* over `entries`, which the handlers change in place. */
export function memoryHandlers(entries: Entry[]): StubHandlers {
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
