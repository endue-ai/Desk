import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { View } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { defineUiPlugin } from "./index";
import { createTestHost, type TestHostOptions } from "./testing/index";

async function mounted(options: Omit<TestHostOptions, "pluginId"> = {}) {
  const host = createTestHost({ pluginId: "example.a", ...options });
  const ctx = await defineUiPlugin({ mount() {} }, host.transport);
  return { host, ctx };
}

const VIEWS = { permission: "view:manage" } as const;
const vectors = join(import.meta.dirname, "../../../specs/view/v0/vectors/valid");
const vector = (name: string) =>
  (JSON.parse(readFileSync(join(vectors, `${name}.json`), "utf8")) as { instance: View }).instance;

describe("ctx.views", () => {
  it("list, get, save and remove go over view.* under view:manage", async () => {
    const { host, ctx } = await mounted({ grants: [VIEWS] });
    const today = vector("view-today");
    await ctx.views.save(today);
    expect(await ctx.views.list()).toEqual([
      { id: "desk.today", version: "0.1.0", title: "Today", description: today.description },
    ]);
    expect(await ctx.views.get("desk.today")).toEqual(today);
    await ctx.views.remove("desk.today");
    expect(await ctx.views.list()).toEqual([]);
    expect(host.calls.map((call) => [call.method, call.params])).toEqual([
      ["view.save", { view: today, scope: VIEWS }],
      ["view.list", { scope: VIEWS }],
      ["view.get", { id: "desk.today", scope: VIEWS }],
      ["view.remove", { id: "desk.today", scope: VIEWS }],
      ["view.list", { scope: VIEWS }],
    ]);
    await expect(ctx.views.get("desk.today")).rejects.toMatchObject({ code: "not_found" });
  });

  it("save rejects an invalid view with invalid_params, and every call is refused without view:manage", async () => {
    const { ctx } = await mounted({ grants: [VIEWS] });
    const broken = {
      ...vector("view-today"),
      layout: { type: "list", binding: { sources: ["$nowhere"] } },
    } as View;
    await expect(ctx.views.save(broken)).rejects.toMatchObject({ code: "invalid_params" });
    expect(await ctx.views.list()).toEqual([]);

    const { ctx: other } = await mounted();
    const refused = { code: "permission_denied", permission: VIEWS };
    await expect(other.views.list()).rejects.toMatchObject(refused);
    await expect(other.views.get("desk.today")).rejects.toMatchObject(refused);
    await expect(other.views.save(vector("view-today"))).rejects.toMatchObject(refused);
    await expect(other.views.remove("desk.today")).rejects.toMatchObject(refused);
  });
});
