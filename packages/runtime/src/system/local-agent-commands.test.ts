import { describe, expect, it, vi } from "vitest";
import { type LocalStub, localAgentsStub } from "../bridge/local-agents";
import type { CommandCaller, CommandSpec } from "../commands";
import type { ShellCtx } from "../shell/context";
import { emptyState, Store } from "../shell/state";
import { askAndWait, defineLocalAgentCommands } from "./local-agent-commands";
import { schemas } from "./local-agent-schemas";

const ERIS: CommandCaller = { caller: "agent:eris" };

function setup(local: LocalStub = localAgentsStub({ epoch: 0, stepMs: 0 }), waitMs = 1000) {
  const store = new Store(emptyState("en"));
  const defined = new Map<string, CommandSpec>();
  const commands = {
    define: (id: string, spec: CommandSpec) => {
      defined.set(id, spec);
      return () => defined.delete(id);
    },
  };
  const ctx = {
    store,
    bridge: { localAgents: local },
    runtime: { commands },
  } as unknown as ShellCtx;
  const off = defineLocalAgentCommands(ctx, { waitMs });
  const run = (id: string, args: unknown, from: CommandCaller = ERIS) => {
    const spec = defined.get(id);
    if (!spec) throw new Error(`no ${id}`);
    return Promise.resolve(spec.run(args, from));
  };
  return { store, defined, local, run, off };
}

describe("desk.agents.* as Eris's tools", () => {
  it("offers every tool to agents with a description and an object schema", () => {
    const { defined, off } = setup();
    const tools = [...defined].filter(([, spec]) => spec.agent);
    expect(tools.map(([id]) => id)).toEqual([
      "desk.agents.list",
      "desk.agents.sessions",
      "desk.agents.transcript",
      "desk.agents.import",
      "desk.agents.ask",
      "desk.agents.dispatch",
      "desk.agents.runs",
    ]);
    for (const [, spec] of tools) {
      expect(spec.owner).toBe("desk");
      expect(spec.agent?.description.length).toBeGreaterThan(40);
      expect(spec.agent?.args).toMatchObject({ type: "object", additionalProperties: false });
    }
    expect(defined.get("desk.agents.import")?.agent?.readOnly).toBeUndefined();
    expect(defined.get("desk.agents.ask")?.agent?.readOnly).toBe(true);
    expect(schemas.dispatch.args.properties).toMatchObject({ tasks: { maxItems: 4 } });
    off();
    expect(defined.size).toBe(0);
  });

  it("lists the agents and one agent's sessions, short", async () => {
    const { run } = setup();
    const listed = (await run("desk.agents.list", {})) as { agents: { id: string }[] };
    expect(listed.agents.map((a) => a.id)).toEqual(["claude", "codex"]);
    const page = (await run("desk.agents.sessions", { agent: "claude", from: "archive" })) as {
      sessions: { title: string }[];
      total: number;
    };
    expect(page.total).toBe(2);
    expect(page.sessions[0]?.title).toBe("Spike: drag and drop on the board");
  });

  it("reads a session's turns", async () => {
    const { local, run } = setup();
    const id = local.fixture.sessions[0]?.id;
    const read = (await run("desk.agents.transcript", { agent: "claude", sessionId: id })) as {
      messages: { role: string }[];
    };
    expect(read.messages.map((m) => m.role)).toEqual(["user", "tool", "assistant"]);
    await expect(run("desk.agents.transcript", { agent: "claude" })).rejects.toThrow(/sessionId/);
  });

  it("hands work over read-only whatever the call says, waits for the answer and marks it Eris's", async () => {
    const { store, local, run } = setup();
    const ask = vi.spyOn(local, "ask");
    const done = (await run("desk.agents.ask", {
      agent: "claude",
      prompt: "Run the tests",
      folder: "~/work/app",
      access: "agent",
    })) as { state: string; text: string; runId: string; sessionId: string };
    expect(ask).toHaveBeenLastCalledWith({
      agent: "claude",
      prompt: "Run the tests",
      access: "read-only",
      cwd: "~/work/app",
    });
    expect(done).toMatchObject({ state: "done", runId: "run-1" });
    expect(done.text).toContain("Run the tests");
    expect(done.sessionId).toBeTruthy();
    expect(store.get().erisRuns).toEqual(["run-1"]);
  });

  it("does not mark the person's own runs as Eris's", async () => {
    const { store, run } = setup();
    await run("desk.agents.ask", { agent: "codex", prompt: "Look" }, {});
    expect(store.get().erisRuns).toEqual([]);
  });

  it("dispatches several pieces of work at once and gathers every answer", async () => {
    const { local, run } = setup();
    const ask = vi.spyOn(local, "ask");
    const result = (await run("desk.agents.dispatch", {
      tasks: [
        { agent: "claude", prompt: "Review the parser" },
        { agent: "codex", prompt: "Review the parser" },
        { agent: "gemini", prompt: "Review the parser" },
      ],
    }).catch((error: Error) => error)) as Error;
    expect(result.message).toMatch(/claude or codex/);
    expect(ask).not.toHaveBeenCalled();
    const both = (await run("desk.agents.dispatch", {
      tasks: [
        { agent: "claude", prompt: "Review the parser" },
        { agent: "codex", prompt: "Review the parser" },
      ],
    })) as { results: { agent: string; state: string }[] };
    expect(ask).toHaveBeenCalledTimes(2);
    expect(both.results.map((r) => [r.agent, r.state])).toEqual([
      ["claude", "done"],
      ["codex", "done"],
    ]);
  });

  it("answers a run that takes too long as running, and the run goes on", async () => {
    const slow = localAgentsStub({ epoch: 0, stepMs: 50 });
    const { run } = setup(slow, 10);
    const answer = (await run("desk.agents.ask", { agent: "claude", prompt: "Long one" })) as {
      state: string;
      runId: string;
    };
    expect(answer.state).toBe("running");
    await new Promise((resolve) => setTimeout(resolve, 250));
    const runs = (await run("desk.agents.runs", { agent: "claude" })) as {
      runs: { runId: string; state: string }[];
    };
    expect(runs.runs[0]).toMatchObject({ runId: answer.runId, state: "done" });
  });

  it("imports an agent's archive into the desk", async () => {
    const { run } = setup();
    expect(await run("desk.agents.import", { agent: "codex", from: "archive" })).toEqual({
      imported: 1,
      unchanged: 0,
      failed: 0,
    });
    await expect(run("desk.agents.import", { agent: "codex", from: "desk" })).rejects.toThrow(
      /local or archive/,
    );
  });

  it("hears the steps that come before ask answers", async () => {
    const local = localAgentsStub({ epoch: 0, stepMs: 0 });
    const ask = local.ask.bind(local);
    local.ask = async (request) => {
      const started = await ask(request);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return started;
    };
    const done = await askAndWait(local, { agent: "codex", prompt: "Quick" }, 1000);
    expect(done.state).toBe("done");
  });
});
