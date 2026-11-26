import { expect, it } from "vitest";
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
