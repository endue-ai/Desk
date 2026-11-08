import { brainSchema } from "@endue-ai/bridge";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import { browserBridge } from "./browser";
import { agentId } from "./directory";

// The stub must answer exactly what specs/brain/v0 allows, or the shell would be built on air.
const ajv = new Ajv2020({ strict: true, validateFormats: false });
ajv.addSchema(brainSchema);
const valid = (target: string, value: unknown) => {
  const validate = ajv.getSchema(`${brainSchema.$id}#/$defs/${target}`);
  if (!validate) throw new Error(`no ${target}`);
  const ok = validate(value);
  if (!ok) throw new Error(`${target}: ${ajv.errorsText(validate.errors)}`);
  return ok;
};

const memory = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
};
const bridge = browserBridge({
  now: () => 0,
  storage: memory(),
  epoch: Date.parse("2026-10-28T09:00:00Z"),
});

describe("the stub's agent directory", () => {
  test("every answer matches the brain contract", async () => {
    expect(valid("SpaceList", await bridge.spaces.list())).toBe(true);
    expect(valid("AgentList", await bridge.agents.list())).toBe(true);
    expect(valid("AgentCard", await bridge.agents.card(agentId(1)))).toBe(true);
    expect(valid("A2ATaskList", await bridge.a2a.tasks())).toBe(true);
  });

  test("filters by space and status, and pages", async () => {
    const home = await bridge.agents.list({ spaceId: "sp_home" });
    expect(home.items.map((a) => a.name)).toEqual(["Mira", "Theo", "Juno"]);
    const inactive = await bridge.agents.list({ status: "inactive" });
    expect(inactive.items.map((a) => a.name)).toEqual(["Juno"]);
    const first = await bridge.agents.list({ limit: 2 });
    expect(first.pagination).toEqual({ total: 5, page: 1, limit: 2, hasNextPage: true });
    const last = await bridge.agents.list({ limit: 2, page: 3 });
    expect(last.items.map((a) => a.name)).toEqual(["Lena"]);
    expect(last.pagination.hasNextPage).toBe(false);
    const mira = await bridge.a2a.tasks({ targetAgentId: agentId(1) });
    expect(mira.items.map((t) => t.goal)).toEqual(["Sort the inbox"]);
  });

  test("refuses what the contract refuses", async () => {
    await expect(bridge.agents.card("ag_nobody")).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
    await expect(bridge.agents.list({ page: 0 })).rejects.toMatchObject({
      status: 400,
      code: "invalid_request",
    });
    await expect(bridge.a2a.tasks({ limit: 101 })).rejects.toMatchObject({ status: 400 });
  });

  test("answers are copies: changing one does not change the directory", async () => {
    const page = await bridge.agents.list();
    const first = page.items[0];
    if (!first) throw new Error("no agents");
    first.name = "Changed";
    expect((await bridge.agents.list()).items[0]?.name).toBe("Mira");
  });
});
