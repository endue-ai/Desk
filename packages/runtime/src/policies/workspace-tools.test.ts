// @vitest-environment jsdom
import type { DataQueryParams, RunItem } from "@endue-ai/bridge";
import { expect, it } from "vitest";
import { browserCore } from "../bridge/core";
import { ManualClock } from "../clock";
import { createRuntime } from "../runtime";
import { invokeAsEris } from "./agent-tool-test";

const example = (id: string, connector: string): RunItem => ({
  id,
  kind: "run",
  source: { connector, instance: "local" },
  title: id,
  agent: id,
  state: "done",
  startedAt: "2026-11-26T01:00:00Z",
  updatedAt: "2026-11-26T01:00:01Z",
  raw: { detail: "Private run fixture" },
});

it("reads state-filtered run summaries of Eris, local agents and MCP", async () => {
  const queries: DataQueryParams[] = [];
  const items = [
    example("eris", "desk.agents"),
    example("local", "endue.local-agents"),
    example("mcp", "desk.mcp"),
  ];
  const core = browserCore({
    manifests: [],
    handlers: {
      "data.query": (params) => {
        queries.push(params);
        return { items };
      },
    },
  });
  const runtime = createRuntime({
    root: document.createElement("div"),
    bridge: core.client,
    clock: new ManualClock(),
  });
  await runtime.ready;
  try {
    await runtime.commands.settled();
    expect(runtime.commands.readOnly("desk.runs.list")).toBe(true);
    expect(await invokeAsEris(core.client, "desk.runs.list", { state: "done" })).toEqual({
      runs: items.map(({ kind: _kind, raw: _raw, updatedAt: _updatedAt, ...item }) => item),
    });
    expect(queries[0]).toMatchObject({
      query: { kinds: ["run"], where: [{ field: "state", op: "eq", value: "done" }] },
      scope: { permission: "data:read", kinds: ["run"] },
    });
  } finally {
    runtime.dispose();
  }
});

it("runs both directions of the command undo stack", async () => {
  const core = browserCore({ manifests: [] });
  const runtime = createRuntime({
    root: document.createElement("div"),
    bridge: core.client,
    clock: new ManualClock(),
  });
  await runtime.ready;
  let value = 0;
  try {
    runtime.commands.define("desk.example.change", {
      owner: "desk",
      title: "Change",
      undo: "desk.example.reverse",
      run: () => {
        value += 1;
        return value;
      },
    });
    runtime.commands.define("desk.example.reverse", {
      owner: "desk",
      title: "Reverse",
      run: () => {
        value -= 1;
      },
    });
    await runtime.commands.settled();
    await runtime.commands.run("desk.example.change");
    expect(value).toBe(1);
    expect(await invokeAsEris(core.client, "desk.undo")).toMatchObject({
      command: "desk.example.change",
    });
    expect(value).toBe(0);
    expect(await invokeAsEris(core.client, "desk.redo")).toMatchObject({
      command: "desk.example.change",
    });
    expect(value).toBe(1);
  } finally {
    runtime.dispose();
  }
});

it("registers session save as an agent tool", async () => {
  const core = browserCore({ manifests: [] });
  const runtime = createRuntime({
    root: document.createElement("div"),
    bridge: core.client,
    clock: new ManualClock(),
  });
  await runtime.ready;
  runtime.commands.setActive(["desk.session"]);
  await runtime.commands.settled();
  try {
    const { commands } = await core.client.call("cmd.list", {
      scope: { permission: "cmd:invoke", ids: ["desk.session.save"] },
    });
    expect(commands).toMatchObject([{ id: "desk.session.save", agent: true }]);
  } finally {
    runtime.dispose();
  }
});
