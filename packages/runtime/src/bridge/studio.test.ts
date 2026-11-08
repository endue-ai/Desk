import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BridgeCallError, type BridgeMethod, type ParamsOf } from "@endue-ai/bridge";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import { browserCore } from "./core";
import { studioHandlers } from "./studio";

// The stub must answer exactly what specs/bridge/v0/studio.schema.json allows, or the agent cards
// would be drawn against shapes the core never sends.
const specs = join(import.meta.dirname, "../../../../specs");
const ajv = new Ajv2020({ strict: true, validateFormats: false });
for (const folder of [
  "plugin/v0",
  "item/v0",
  "view/v0",
  "connector/v0",
  "memory/v0",
  "agent/v0",
  "market/v0",
  "init/v0",
  "bridge/v0",
])
  for (const name of readdirSync(join(specs, folder)).filter((n) => n.endsWith(".schema.json")))
    ajv.addSchema(JSON.parse(readFileSync(join(specs, folder, name), "utf8")));
const STUDIO = "https://endue.ai/specs/bridge/v0/studio.schema.json";
const shaped = (target: string, value: unknown) => {
  const validate = ajv.getSchema(`${STUDIO}#/$defs/${target}`);
  if (!validate) throw new Error(`no ${target}`);
  if (!validate(value)) throw new Error(`${target}: ${ajv.errorsText(validate.errors)}`);
  return true;
};

const scope = { permission: "studio:manage" } as const;
const PLUGIN = "endue.agents";

function desk(options: Parameters<typeof studioHandlers>[0] = {}) {
  const studio = studioHandlers({ epoch: Date.parse("2026-11-07T09:00:00Z"), ...options });
  const core = browserCore({ manifests: [], handlers: studio.handlers });
  const call = <M extends BridgeMethod>(method: M, params: Omit<ParamsOf<M>, "scope">) =>
    core.client.call(method, { ...params, scope } as ParamsOf<M>, { caller: PLUGIN });
  return { studio, core, call };
}

describe("the browser stub answers studio.*", () => {
  test("lists the sample agents, reads one and its facets, in the bridge's shapes", async () => {
    const { call } = desk();
    const list = await call("studio.agents.list", {});
    expect(shaped("StudioAgentsListResult", list)).toBe(true);
    expect(list.agents.map((a) => a.name)).toEqual(["Miso", "Mailie", "Scout"]);
    expect(list.agents[1]?.sourceCatalog).toEqual({
      catalogAgentId: "cat_support_mail",
      version: 3,
    });
    const id = list.agents[0]?.id ?? "";
    expect(shaped("StudioAgentsGetResult", await call("studio.agents.get", { agentId: id }))).toBe(
      true,
    );
    const facets = await call("studio.agents.facets", { agentId: id });
    expect(shaped("StudioAgentsFacetsResult", facets)).toBe(true);
    expect(facets.identity?.role).toBe("Keeps my calendar and sorts my mail");
    expect(facets.prompt?.rev).toBe(1);
    expect(facets.settings?.model.default).toBe("anthropic/claude-sonnet-4.5");
  });

  test("creates, changes, turns off, prompts and removes an agent", async () => {
    const { call } = desk({ agents: false });
    const created = await call("studio.agents.create", {
      name: " Miso ",
      role: "Mail",
      model: "m-1",
    });
    expect(shaped("StudioAgentsCreateResult", created)).toBe(true);
    const agentId = created.agent.id;
    expect(created.agent).toMatchObject({ name: "Miso", slug: "miso", status: "active" });
    const updated = await call("studio.agents.update", {
      agentId,
      name: "Miso 2",
      visibility: "unlisted",
    });
    expect(shaped("StudioAgentsUpdateResult", updated)).toBe(true);
    expect(updated.agent).toMatchObject({ name: "Miso 2", slug: "miso" });
    const off = await call("studio.agents.setStatus", { agentId, status: "inactive" });
    expect(shaped("StudioAgentsSetStatusResult", off) && off.agent.status).toBe("inactive");
    await call("studio.agents.prompt.update", { agentId, content: "Be brief." });
    await call("studio.agents.prompt.update", { agentId, content: "Be kind." });
    const restored = await call("studio.agents.prompt.update", { agentId, restore: 1 });
    expect(shaped("StudioAgentsPromptUpdateResult", restored)).toBe(true);
    expect(restored.prompt).toMatchObject({
      rev: 3,
      content: "Be brief.",
      source: "restore",
      restoredFromRev: 1,
    });
    const facets = await call("studio.agents.facets", { agentId });
    expect(facets.revisions.map((r) => [r.rev, r.active])).toEqual([
      [3, true],
      [2, false],
      [1, false],
    ]);
    expect(facets.settings?.visibility).toBe("unlisted");
    const removed = await call("studio.agents.remove", { agentId });
    expect(shaped("StudioAgentsRemoveResult", removed)).toBe(true);
    expect((await call("studio.agents.list", {})).agents).toEqual([]);
    await expect(call("studio.agents.get", { agentId })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  test("refuses what the core refuses: nothing to change, a blank name, content and restore", async () => {
    const { call } = desk();
    const agentId = (await call("studio.agents.list", {})).agents[0]?.id ?? "";
    for (const attempt of [
      call("studio.agents.update", { agentId }),
      call("studio.agents.create", { name: "  ", role: "x" }),
      call("studio.agents.prompt.update", { agentId, content: "a", restore: 1 }),
    ])
      await expect(attempt).rejects.toMatchObject({ code: "invalid_params" });
  });

  test("finds catalog agents and starts one", async () => {
    const { call } = desk({ agents: false });
    const catalog = await call("studio.catalog.list", { query: "mail" });
    expect(shaped("StudioCatalogListResult", catalog)).toBe(true);
    expect(catalog.agents.map((a) => a.slug)).toEqual(["support-mail"]);
    const found = await call("studio.catalog.recommend", { query: "help with my calendar" });
    expect(shaped("StudioCatalogRecommendResult", found)).toBe(true);
    expect(found.matches.map((m) => m.slug)).toEqual(["calendar-keeper"]);
    const used = await call("studio.catalog.use", { slug: "support-mail", locale: "ko" });
    expect(shaped("StudioCatalogUseResult", used)).toBe(true);
    expect(used.agent.sourceCatalog?.catalogAgentId).toBe("cat_support_mail");
    expect((await call("studio.agents.list", {})).agents).toHaveLength(1);
    await expect(call("studio.catalog.use", { slug: "no-such" })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  test("lists the Home board's conversations, by agent and by column", async () => {
    const { call } = desk();
    const all = await call("studio.conversations.list", {});
    expect(shaped("StudioConversationsListResult", all)).toBe(true);
    expect(all.conversations.map((c) => c.activity)).toEqual([
      "active",
      "waiting",
      "failed",
      "done",
    ]);
    const miso = (await call("studio.agents.list", {})).agents[0]?.id ?? "";
    const mine = await call("studio.conversations.list", { agentId: miso, limit: 1 });
    expect(mine.conversations.every((c) => c.agentId === miso)).toBe(true);
    expect([mine.total, mine.hasMore]).toEqual([2, true]);
    const waiting = await call("studio.conversations.list", { awaitingInput: true });
    expect(waiting.conversations.map((c) => c.title)).toEqual(["Refund for order 42"]);
  });

  test("signed out is signed_out, and a caller without studio:manage is refused", async () => {
    const { studio, call } = desk();
    studio.setSignedIn(false);
    const error = await call("studio.agents.list", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BridgeCallError);
    expect(error).toMatchObject({ code: "signed_out" });
    studio.setSignedIn(true);
    expect((await call("studio.agents.list", {})).agents).toHaveLength(3);

    const strict = desk({ grants: { other: [{ permission: "agents:manage" }] } });
    await expect(strict.call("studio.agents.list", {})).rejects.toMatchObject({
      code: "permission_denied",
      permission: scope,
    });
  });
});
