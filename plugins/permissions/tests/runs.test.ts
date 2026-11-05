// The fleet board's actions on agents' runs (ADR 0100): approve or deny the approval a run waits for
// with perm.approve, and stop a run with agent.cancel, as the perm:manage holder.
import { describe, expect, it } from "vitest";
import { defineUiPlugin } from "../../../packages/plugin-sdk/src/index";
import { createTestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { wireRuns } from "../ui/runs.js";

async function mounted() {
  const host = createTestHost({
    pluginId: "endue.permissions",
    handlers: {
      "perm.approve": () => ({}),
      "agent.cancel": () => ({ cancelled: true }),
    },
  });
  await defineUiPlugin({ mount: (ctx) => wireRuns(ctx) }, host.transport);
  // The runtime registers a plugin's contributed commands; the test host leaves it to the test.
  for (const id of ["approve", "deny", "cancel-run"])
    await host.call(
      "cmd.register",
      { id: `endue.permissions.${id}`, title: id },
      "endue.permissions",
    );
  await host.settle();
  const params = (method: string) =>
    host.calls.filter((c) => c.method === method).map((c) => c.params);
  return { host, params };
}

const MANAGE = { permission: "perm:manage" };

describe("the fleet board's actions", () => {
  it("approve and deny the approval a run waits for", async () => {
    const { host, params } = await mounted();
    expect(await host.invoke("endue.permissions.approve", { approval: "a-7" })).toEqual({
      approved: true,
    });
    await host.invoke("endue.permissions.approve", { approval: "a-8", answer: "task" });
    await host.invoke("endue.permissions.deny", { approval: "a-9" });
    expect(params("perm.approve")).toEqual([
      { approvalId: "a-7", answer: "once", scope: MANAGE },
      { approvalId: "a-8", answer: "task", scope: MANAGE },
      { approvalId: "a-9", answer: "deny", scope: MANAGE },
    ]);
    await expect(host.invoke("endue.permissions.approve", {})).rejects.toThrow(
      /waits for approval/,
    );
  });

  it("stop a run, naming its source when it is a plugin's", async () => {
    const { host, params } = await mounted();
    const core = { connector: "desk.agents", instance: "default" };
    const local = { connector: "endue.local-agents", instance: "default" };
    expect(
      await host.invoke("endue.permissions.cancel-run", { run: "run-3", source: core }),
    ).toEqual({ cancelled: true });
    await host.invoke("endue.permissions.cancel-run", { run: "r12", source: local });
    expect(params("agent.cancel")).toEqual([
      { runId: "run-3", scope: MANAGE },
      { runId: "r12", scope: MANAGE, source: local },
    ]);
    await expect(host.invoke("endue.permissions.cancel-run", {})).rejects.toThrow(/Which run/);
  });
});
