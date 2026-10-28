import { brainSchema } from "@endue-ai/bridge";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import { browserBridge } from "./browser";
import { agentId } from "./directory";

// The stub must answer what endue AI's API gateway answers (specs/brain/v0), or the shell is built on air.
const ajv = new Ajv2020({ strict: true, validateFormats: false });
ajv.addSchema(brainSchema);
const valid = (target: string, value: unknown) => {
  const validate = ajv.getSchema(`${brainSchema.$id}#/$defs/${target}`);
  if (!validate) throw new Error(`no ${target}`);
  if (!validate(value)) throw new Error(`${target}: ${ajv.errorsText(validate.errors)}`);
  return true;
};

const memory = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
};
const bridge = browserBridge({ now: () => 0, storage: memory() });

describe("the stub's agents and spaces", () => {
  test("every answer matches the gateway's shapes", async () => {
    expect(valid("AgentList", await bridge.agents.list())).toBe(true);
    expect(valid("SpaceList", await bridge.spaces.list())).toBe(true);
    expect(valid("SpaceAgentList", await bridge.spaces.agents("sp_home"))).toBe(true);
  });

  test("agents come newest first, a page at a time; the limit is lowered to 50, the page raised to 1", async () => {
    const all = await bridge.agents.list();
    expect(all.items.map((a) => a.name)).toEqual(["Mira", "Theo", "Juno", "Kai", "Lena"]);
    const first = await bridge.agents.list({ limit: 2 });
    expect(first.pagination).toEqual({ total: 5, page: 1, limit: 2, has_next_page: true });
    const last = await bridge.agents.list({ limit: 2, page: 3 });
    expect(last.items.map((a) => a.name)).toEqual(["Lena"]);
    expect(last.pagination.has_next_page).toBe(false);
    expect((await bridge.agents.list({ limit: 500 })).pagination.limit).toBe(50);
    expect((await bridge.agents.list({ page: 0 })).pagination.page).toBe(1);
  });

  test("spaces are a plain array; a space lists the agents taking part in it", async () => {
    const spaces = await bridge.spaces.list();
    expect(spaces.map((sp) => sp.id)).toEqual(["sp_home", "sp_studio"]);
    const home = await bridge.spaces.agents("sp_home");
    expect(home.data.map((a) => a.agent_id)).toEqual([agentId(1), agentId(2), agentId(3)]);
    expect(home.data.find((a) => a.is_front)?.agent_id).toBe(agentId(1));
    await expect(bridge.spaces.agents("sp_nowhere")).rejects.toMatchObject({ status: 404 });
  });

  test("answers are copies: changing one does not change the directory", async () => {
    const page = await bridge.agents.list();
    const first = page.items[0];
    if (!first) throw new Error("no agents");
    first.name = "Changed";
    expect((await bridge.agents.list()).items[0]?.name).toBe("Mira");
  });
});
