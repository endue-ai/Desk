// What the island shows (ADR 0204), without a DOM: the agents at work and the asks that wait, as
// they come and go.
import type { AgentRecord, BridgeEvent, PermApprovalData, PermPromptData } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import {
  asksAfter,
  asksOf,
  callerName,
  QUIET,
  runningOf,
  runsAfter,
  summary,
  touchesAgents,
  workingOf,
} from "./island-model";

const prompt = (promptId: string, caller = "endue.notes"): PermPromptData => ({
  promptId,
  caller,
  permission: { permission: "fs:read", paths: ["~/Notes/**"] },
  duration: "session",
});

const approval = (approvalId: string): PermApprovalData => ({
  approvalId,
  caller: "agent:mira",
  action: "fs.write",
  permission: { permission: "fs:write", paths: ["~/Notes/**"] },
  target: "~/Notes/a.md",
});

const agent = (id: string, state: AgentRecord["state"], colour?: string): AgentRecord => ({
  id,
  name: id === "eris" ? "Eris" : id,
  source: id === "eris" ? "eris" : "init",
  state,
  ...(colour ? { colour } : {}),
});

describe("the island's model", () => {
  it("names callers in words", () => {
    expect(callerName("agent:mira")).toBe("mira");
    expect(callerName("desk")).toBe("endue");
    expect(callerName("endue.notes")).toBe("endue.notes");
  });

  it("starts from what perm.pending says waits, prompts first, each in its order", () => {
    const asks = asksOf({ prompts: [prompt("p-1"), prompt("p-3")], approvals: [approval("a-2")] });
    expect(asks.map((a) => `${a.kind}:${a.id}`)).toEqual([
      "prompt:p-1",
      "prompt:p-3",
      "approval:a-2",
    ]);
    expect(asks[0]).toEqual({
      kind: "prompt",
      id: "p-1",
      who: "endue.notes",
      what: "asks for fs:read",
    });
    expect(asks[2]).toEqual({
      kind: "approval",
      id: "a-2",
      who: "mira",
      what: "waits to run fs.write on ~/Notes/a.md",
    });
  });

  it("counts an ask when it comes and stops counting it when any prompter answered it", () => {
    let asks = asksOf({ prompts: [], approvals: [] });
    const came: BridgeEvent = { event: "perm.prompt", data: prompt("p-1") };
    asks = asksAfter(asks, came) ?? asks;
    asks = asksAfter(asks, { event: "perm.approval", data: approval("a-1") }) ?? asks;
    expect(asks).toHaveLength(2);
    // The same prompt delivered again is one ask.
    expect(asksAfter(asks, came)).toBeUndefined();
    // A prompt and an approval may share a number: each settles only its own.
    const settled: BridgeEvent = { event: "perm.settled", data: { kind: "approval", id: "a-1" } };
    asks = asksAfter(asks, settled) ?? asks;
    expect(asks.map((a) => a.id)).toEqual(["p-1"]);
    expect(asksAfter(asks, settled), "already gone").toBeUndefined();
    asks = asksAfter(asks, { event: "perm.settled", data: { kind: "prompt", id: "p-1" } }) ?? asks;
    expect(asks).toEqual([]);
    expect(
      asksAfter(asks, { event: "perm.changed", data: { grantId: "g", change: "granted" } }),
    ).toBeUndefined();
  });

  it("shows the agents agent.list says are working, and the agent programs while they run", () => {
    const agents = [
      agent("eris", "idle"),
      agent("mira", "working", "#3366ff"),
      agent("rex", "waiting"),
    ];
    expect(workingOf(agents)).toEqual([{ id: "mira", name: "mira", colour: "#3366ff" }]);
    const run = {
      runId: "r-1",
      agent: "claude" as const,
      caller: "eris",
      prompt: "Fix the tests",
      cwd: "~/code",
      access: "read-only" as const,
      startedAt: "2026-11-13T10:00:00.000Z",
      text: "",
      tools: 0,
    };
    let runs = runningOf([
      { ...run, state: "running" },
      { ...run, runId: "r-0", state: "done" },
    ]);
    expect([...runs.values()]).toEqual([{ id: "run:r-1", name: "Claude Code" }]);
    const started: BridgeEvent = {
      event: "agents.run",
      data: { runId: "r-2", agent: "codex", kind: "started" },
    };
    runs = runsAfter(runs, started) ?? runs;
    expect([...runs.values()].map((w) => w.name)).toEqual(["Claude Code", "Codex"]);
    const step: BridgeEvent = {
      event: "agents.run",
      data: { runId: "r-2", agent: "codex", kind: "text", text: "Looking" },
    };
    expect(runsAfter(runs, step), "a step changes nothing").toBeUndefined();
    for (const kind of ["done", "failed", "stopped"] as const) {
      const ended = runsAfter(runs, {
        event: "agents.run",
        data: { runId: "r-1", agent: "claude", kind },
      });
      expect([...(ended ?? runs).keys()]).toEqual(["r-2"]);
    }
  });

  it("reads the agents again after what may change one, and says it all in a few words", () => {
    const changed: BridgeEvent = {
      event: "agent.changed",
      data: { agent: "mira", runId: "run-1" },
    };
    expect(touchesAgents(changed)).toBe(true);
    expect(touchesAgents({ event: "perm.settled", data: { kind: "prompt", id: "p-1" } })).toBe(
      false,
    );
    expect(
      touchesAgents({ event: "perm.changed", data: { grantId: "g", change: "granted" } }),
    ).toBe(false);
    expect(summary(QUIET)).toBe("All quiet");
    const mira = { id: "mira", name: "mira" };
    const ask = { kind: "prompt" as const, id: "p-1", who: "x", what: "y" };
    expect(summary({ working: [mira], asks: [] })).toBe("1 agent at work");
    expect(summary({ working: [mira, mira], asks: [ask] })).toBe("2 agents at work · 1 ask waits");
    expect(summary({ working: [], asks: [ask, ask, ask] })).toBe("3 asks wait");
  });
});
