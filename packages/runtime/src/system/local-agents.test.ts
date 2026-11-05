import type { LocalAgentRun } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { localAgentsStub } from "../bridge/local-agents";
import type { Ctx } from "../shell/actions";
import { emptyState, Store } from "../shell/state";
import {
  applyRunStep,
  badgeOf,
  loadLocalAgents,
  localName,
  localPresence,
  watchLocalAgents,
} from "./local-agents";

const run = (over: Partial<LocalAgentRun> = {}): LocalAgentRun => ({
  runId: "run-1",
  agent: "claude",
  caller: "desk",
  prompt: "Run the tests",
  cwd: "/home/person/work/app",
  access: "read-only",
  state: "running",
  startedAt: "2026-11-05T09:00:00Z",
  text: "",
  tools: 0,
  ...over,
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

function setup() {
  const store = new Store(emptyState("en"));
  const local = localAgentsStub({ epoch: Date.parse("2026-11-05T10:00:00Z"), stepMs: 0 });
  const ctx = { store, bridge: { localAgents: local } } as unknown as Ctx;
  return { store, local, ctx };
}

describe("local agents in the shell", () => {
  it("names each program and gives Claude Code and Codex two letters apart", () => {
    expect(badgeOf("claude")).toBe("CC");
    expect(badgeOf("codex")).toBe("Cx");
    expect(localName([], "codex")).toBe("Codex");
  });

  it("adds a run's text blocks and tools, and takes the whole run on its end", () => {
    let runs = applyRunStep([], { runId: "run-1", agent: "claude", kind: "started", run: run() });
    runs = applyRunStep(runs, { runId: "run-1", agent: "claude", kind: "tool", tool: "Bash" });
    runs = applyRunStep(runs, {
      runId: "run-1",
      agent: "claude",
      kind: "text",
      text: "First.",
      sessionId: "s-1",
    });
    runs = applyRunStep(runs, { runId: "run-1", agent: "claude", kind: "text", text: "Second." });
    expect(runs[0]).toMatchObject({ tools: 1, text: "First.\n\nSecond.", sessionId: "s-1" });
    expect(localPresence("claude", runs)).toBe("working");
    const done = run({ state: "done", text: "Two tests fail.", tools: 3 });
    runs = applyRunStep(runs, { runId: "run-1", agent: "claude", kind: "done", run: done });
    expect(runs).toEqual([done]);
    expect(localPresence("claude", runs)).toBe("idle");
  });

  it("leaves a step of a run it does not know for the run it brings", () => {
    const step = { runId: "run-9", agent: "codex" as const, kind: "text" as const, text: "Hi" };
    expect(applyRunStep([run()], step)).toEqual([run()]);
  });

  it("reads the agents found and follows every step and import", async () => {
    const { store, local, ctx } = setup();
    await loadLocalAgents(ctx);
    expect(store.get().localAgents.map((a) => [a.id, a.sessions, a.archived])).toEqual([
      ["claude", 4, 2],
      ["codex", 2, 1],
    ]);
    const off = watchLocalAgents(ctx);
    await local.ask({ agent: "codex", prompt: "Look at the resizer" });
    await settle();
    const [ran] = store.get().localRuns;
    expect(ran).toMatchObject({ agent: "codex", state: "done", tools: 1 });
    expect(ran?.text).toContain("Look at the resizer");
    await local.import("codex", "archive");
    await settle();
    expect(store.get().localAgents.find((a) => a.id === "codex")?.imported).toBe(1);
    off();
  });

  it("leaves a desk without local agents as it is", async () => {
    const store = new Store(emptyState("en"));
    const ctx = { store, bridge: {} } as unknown as Ctx;
    await loadLocalAgents(ctx);
    expect(store.get().localAgents).toEqual([]);
    expect(watchLocalAgents(ctx)).toBeTypeOf("function");
  });
});
