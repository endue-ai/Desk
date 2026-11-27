import { expect, it, vi } from "vitest";
import type { PluginContext } from "../../../packages/plugin-sdk/src/index";
import { installAgentCommands } from "../ui/agent-commands.js";
import { mount } from "./harness";

it("lists fresh Studio agents without exposing conversations or local runtime details", async () => {
  const test = await mount();
  try {
    const before = test.params("studio.agents.list").length;
    const result = await test.app.listAgents();
    expect(test.params("studio.agents.list")).toHaveLength(before + 1);
    expect(result).toMatchObject({ agents: [{ id: "ag_miso", name: "Miso" }, { id: "ag_ria" }] });
    expect(Object.keys(result.agents[0] ?? {}).sort()).toEqual(["id", "name", "slug", "status"]);
  } finally {
    test.app.dispose();
  }
});

it("opens Studio and New agent as pages, and keeps reads in the background", async () => {
  const test = await mount();
  type Handler = Parameters<PluginContext["commands"]["on"]>[1];
  const handlers = new Map<string, Handler>();
  const show = vi.fn();
  const ctx = {
    commands: { on: (id: string, handler: Handler) => void handlers.set(id, handler) },
    surface: { show },
  } as unknown as Pick<PluginContext, "commands" | "surface">;
  const from = { invocationId: "test", caller: "agent:eris" };
  try {
    installAgentCommands(ctx, test.app);
    await handlers.get("endue.agents.list")?.({}, from);
    expect(show).not.toHaveBeenCalled();
    const studio = handlers.get("endue.agents.studio");
    await expect(studio?.({ agent: "unknown" }, from)).rejects.toThrow(/ID/);
    expect(test.app.route.page).toBe("home");
    await studio?.({ agent: "ag_miso", facet: "identity" }, from);
    expect(test.app.route).toMatchObject({
      page: "studio",
      key: "endue:ag_miso",
      facet: "identity",
    });
    expect(show).toHaveBeenCalledOnce();
    await handlers.get("endue.agents.new")?.({}, from);
    expect(test.app.route.page).toBe("create");
    expect(show).toHaveBeenCalledTimes(2);
    expect(test.params("studio.agents.create")).toEqual([]);
  } finally {
    test.app.dispose();
  }
});
