/**
 * The agent programs on this computer on the browser stub (dev pages, tests, fixture screenshots;
 * never shipped): a Claude Code and a Codex with fixture sessions, imports kept in memory, and runs
 * that answer from a script, step by step, as the core's agents.run events would (ADR 0110).
 */
import type {
  LocalAgent,
  LocalAgentId,
  LocalAgentMessage,
  LocalAgentRun,
  LocalAgentRunData,
  LocalAgentSession,
} from "@endue-ai/bridge";
import type { LocalAgentEvent, LocalAgentsBridge, LocalAsk } from "./types";

export interface LocalStubOptions {
  /** Wall-clock milliseconds the fixture's times are relative to. */
  epoch: number;
  /** Between two steps of a run; 0 runs them on the next tasks (tests). */
  stepMs?: number;
  /** How a run answers its prompt; the default says it looked and what it found. */
  answer?: (ask: LocalAsk) => string;
}

export interface LocalStub extends LocalAgentsBridge {
  /** The fixture behind the answers; tests edit it in place. */
  fixture: LocalFixture;
}

export interface LocalFixture {
  agents: LocalAgent[];
  sessions: LocalAgentSession[];
  messages: Record<string, LocalAgentMessage[]>;
  runs: LocalAgentRun[];
}

const MINUTE = 60_000;
const HOME = "/Users/you";

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

function session(
  epoch: number,
  agent: LocalAgentId,
  n: number,
  title: string,
  folder: string,
  minutesAgo: number,
  archived = false,
): LocalAgentSession {
  const hex = n.toString(16).padStart(4, "0");
  return {
    id: `${agent === "claude" ? "5b1c2d3e" : "019a7f00"}-0000-4000-8000-00000000${hex}`,
    agent,
    title,
    cwd: `${HOME}/work/${folder}`,
    branch: "main",
    startedAt: iso(epoch - (minutesAgo + 40) * MINUTE),
    updatedAt: iso(epoch - minutesAgo * MINUTE),
    archived,
    imported: false,
    size: 18_000 + n * 4_100,
    version: agent === "claude" ? "2.4.1" : "0.61.0",
    model: agent === "claude" ? "claude-opus-5-5" : "gpt-6-codex",
  };
}

/** Two programs, nine sessions, three of them archived. */
export function sampleLocalFixture(epoch: number): LocalFixture {
  const sessions = [
    session(epoch, "claude", 1, "Fix the flaky upload test", "atlas", 12),
    session(epoch, "claude", 2, "Add dark mode to the settings page", "atlas", 95),
    session(epoch, "claude", 3, "Explain the sync engine", "harbor", 60 * 26),
    session(epoch, "claude", 4, "Write the release notes for 1.4", "harbor", 60 * 50),
    session(epoch, "claude", 5, "Spike: drag and drop on the board", "atlas", 60 * 24 * 9, true),
    session(epoch, "claude", 6, "Old CI migration", "harbor", 60 * 24 * 21, true),
    session(epoch, "codex", 1, "Rename the config loader", "harbor", 33),
    session(epoch, "codex", 2, "Speed up the image resizer", "lumen", 60 * 7),
    session(epoch, "codex", 3, "Port the parser to streams", "lumen", 60 * 24 * 14, true),
  ];
  const messages: Record<string, LocalAgentMessage[]> = {};
  for (const s of sessions) {
    messages[s.id] = [
      { role: "user", text: `${s.title}.`, at: s.startedAt },
      { role: "tool", name: s.agent === "claude" ? "Bash" : "shell", text: "rg -n upload src" },
      {
        role: "assistant",
        text: "I read the code around it. The change is small: two files, and one test to update.",
        at: s.updatedAt,
      },
    ];
  }
  const agent = (id: LocalAgentId): LocalAgent => ({
    id,
    name: id === "claude" ? "Claude Code" : "Codex",
    vendor: id === "claude" ? "Anthropic" : "OpenAI",
    program: `/usr/local/bin/${id}`,
    version: id === "claude" ? "2.4.1" : "0.61.0",
    home: `${HOME}/.${id}`,
    sessions: 0,
    archived: 0,
    imported: 0,
    running: 0,
  });
  return { agents: [agent("claude"), agent("codex")], sessions, messages, runs: [] };
}

function defaultAnswer(ask: LocalAsk): string {
  const line = ask.prompt.trim().split("\n")[0]?.slice(0, 80) ?? "";
  return `I looked into "${line}". The tests pass except one: upload waits on a timer.`;
}

class StubError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function localAgentsStub(options: LocalStubOptions): LocalStub {
  const fixture = sampleLocalFixture(options.epoch);
  const listeners = new Set<(event: LocalAgentEvent) => void>();
  const step = options.stepMs ?? 300;
  let next = 0;
  const started = Date.now();
  const now = () => iso(options.epoch + (Date.now() - started));
  const wire = <T>(value: T): Promise<T> => Promise.resolve(structuredClone(value));
  const emit = (event: LocalAgentEvent) => {
    for (const listener of [...listeners]) listener(structuredClone(event));
  };
  const agentOf = (id: LocalAgentId) => {
    const found = fixture.agents.find((a) => a.id === id);
    if (!found) throw new StubError("not_found", `${id} is not on this computer`);
    return found;
  };
  const counted = (a: LocalAgent): LocalAgent => {
    const mine = fixture.sessions.filter((s) => s.agent === a.id);
    return {
      ...a,
      sessions: mine.filter((s) => !s.archived).length,
      archived: mine.filter((s) => s.archived).length,
      imported: mine.filter((s) => s.imported).length,
      running: fixture.runs.filter((r) => r.agent === a.id && r.state === "running").length,
    };
  };
  const later = (f: () => void, n: number) => setTimeout(f, step * n);
  const send = (run: LocalAgentRun, data: Omit<LocalAgentRunData, "runId" | "agent">) =>
    emit({ kind: "run", data: { runId: run.runId, agent: run.agent, ...data } });

  return {
    fixture,
    list: async () => wire(fixture.agents.map(counted)),
    async sessions(agent, query = {}) {
      agentOf(agent);
      const from = query.from ?? "local";
      const words = (query.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const matching = fixture.sessions
        .filter((s) => s.agent === agent)
        .filter((s) => (from === "desk" ? s.imported : s.archived === (from === "archive")))
        .filter((s) => {
          const text = `${s.title} ${s.cwd ?? ""} ${s.branch ?? ""}`.toLowerCase();
          return words.every((w) => text.includes(w));
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const offset = query.offset ?? 0;
      const sessions = matching.slice(offset, offset + (query.limit ?? 50));
      return wire({ sessions, total: matching.length });
    },
    async transcript(agent, sessionId, limit = 200) {
      const found = fixture.sessions.find((s) => s.agent === agent && s.id === sessionId);
      if (!found) throw new StubError("not_found", `${agent} has no session ${sessionId}`);
      const all = fixture.messages[sessionId] ?? [];
      const messages = all.slice(-limit);
      return wire({ session: found, messages, truncated: messages.length < all.length });
    },
    async import(agent, from, sessionIds) {
      agentOf(agent);
      const set = fixture.sessions.filter(
        (s) =>
          s.agent === agent &&
          (sessionIds ? sessionIds.includes(s.id) : s.archived === (from === "archive")),
      );
      let imported = 0;
      let unchanged = 0;
      for (const s of set) {
        if (s.imported) unchanged += 1;
        else {
          s.imported = true;
          s.importedAt = now();
          imported += 1;
        }
      }
      if (imported) emit({ kind: "changed", agent });
      return wire({ imported, unchanged, failed: 0 });
    },
    async ask(ask) {
      const agent = agentOf(ask.agent);
      const resumed = ask.sessionId
        ? fixture.sessions.find((s) => s.agent === ask.agent && s.id === ask.sessionId)
        : undefined;
      next += 1;
      const run: LocalAgentRun = {
        runId: `run-${next}`,
        agent: agent.id,
        caller: "desk",
        prompt: ask.prompt.slice(0, 500),
        cwd: resumed?.cwd ?? ask.cwd?.replace(/^~/, HOME) ?? HOME,
        ...(resumed ? { sessionId: resumed.id } : {}),
        access: ask.access ?? "read-only",
        state: "running",
        startedAt: now(),
        text: "",
        tools: 0,
      };
      fixture.runs.unshift(run);
      fixture.runs.splice(50);
      const sessionId =
        run.sessionId ?? `${agent.id === "claude" ? "5b1c2d3e" : "019a7f00"}-run-${next}`;
      const answer = (options.answer ?? defaultAnswer)(ask);
      later(() => send(run, { kind: "started", run: structuredClone(run) }), 0);
      later(() => {
        if (run.state !== "running") return;
        run.sessionId = sessionId;
        run.tools += 1;
        send(run, { kind: "tool", tool: "Bash", detail: "pnpm test", sessionId });
      }, 1);
      later(() => {
        if (run.state !== "running") return;
        run.text = answer;
        send(run, { kind: "text", text: answer, sessionId });
      }, 2);
      later(() => {
        if (run.state !== "running") return;
        run.state = "done";
        run.endedAt = now();
        send(run, { kind: "done", sessionId, run: structuredClone(run) });
      }, 3);
      return structuredClone(run);
    },
    runs: async (agent) => wire(fixture.runs.filter((r) => !agent || r.agent === agent)),
    async stop(runId) {
      const run = fixture.runs.find((r) => r.runId === runId && r.state === "running");
      if (!run) throw new StubError("not_found", `no run ${runId} is going on`);
      run.state = "stopped";
      run.endedAt = now();
      send(run, { kind: "stopped", run: structuredClone(run) });
      return structuredClone(run);
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
