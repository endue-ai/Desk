// @vitest-environment jsdom
import type { DataQueryParams, TaskItem } from "@endue-ai/bridge";
import { expect, it } from "vitest";
import { browserCore } from "../bridge/core";
import { ManualClock } from "../clock";
import { createRuntime } from "../runtime";
import { invokeAsEris } from "./agent-tool-test";

function task(id: string, connector: string, project: string, pull = false): TaskItem {
  return {
    kind: "task",
    id,
    source: { connector, instance: "work" },
    title: id,
    project,
    status: "open",
    updatedAt: "2026-11-26T01:00:00Z",
    deepLink: `https://github.com/${project}/${pull ? "pull" : "issues"}/1`,
    raw: { fixture: "Raw record", ...(pull ? { pull_request: {} } : {}) },
  };
}

it("reads only the active GitHub connector's synced work with filters and a bounded answer", async () => {
  const queries: DataQueryParams[] = [];
  const core = browserCore({
    manifests: [],
    handlers: {
      "data.query": (params) => {
        queries.push(params);
        return params.query.cursor
          ? { items: [task("second PR", "desk.github", "Acme/Project", true)] }
          : {
              items: [
                task("issue", "desk.github", "Acme/Project"),
                task("other source", "desk.jira", "Acme/Project", true),
                task("other repo", "desk.github", "Other/Project", true),
                task("first PR", "desk.github", "Acme/Project", true),
              ],
              cursor: "page-two",
            };
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
    runtime.commands.setActive(["desk.github"]);
    await runtime.commands.settled();
    expect(runtime.commands.readOnly("endue.github.work")).toBe(true);
    const answer = await invokeAsEris(core.client, "endue.github.work", {
      kind: "pull-request",
      repo: "acme/project",
      status: "open",
      limit: 1,
    });
    expect(answer).toMatchObject({
      work: [{ id: "first PR", kind: "pull-request", repo: "Acme/Project", status: "open" }],
      more: true,
    });
    expect(JSON.stringify(answer)).not.toContain("Raw record");
    expect(queries[0]).toMatchObject({
      scope: { permission: "data:read", kinds: ["task"], sources: ["desk.github"] },
      query: {
        kinds: ["task"],
        sources: ["desk.github"],
        where: [{ field: "status", op: "eq", value: "open" }],
      },
    });
    expect(queries[1]?.query.cursor).toBe("page-two");
    runtime.commands.setActive([]);
    await runtime.commands.settled();
    expect(runtime.commands.has("endue.github.work")).toBe(false);
  } finally {
    runtime.dispose();
  }
});
