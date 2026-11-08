import { describe, expect, it } from "vitest";
import { defineUiPlugin } from "./index";
import { createTestHost, type TestHostOptions } from "./testing/index";

async function mounted(options: Omit<TestHostOptions, "pluginId"> = {}) {
  const host = createTestHost({ pluginId: "example.a", ...options });
  const ctx = await defineUiPlugin({ mount() {} }, host.transport);
  return { host, ctx };
}

const NOTIFY = { permission: "ui:notify" } as const;

describe("ctx.perm", () => {
  it("requests with a duration and queries the grant", async () => {
    const { host, ctx } = await mounted();
    const result = await ctx.perm.request(NOTIFY, "to say hello", "session");
    expect(result).toMatchObject({ granted: true, grant: { permission: NOTIFY } });
    expect(result.grant?.duration).toBe("session");
    expect(host.grants).toEqual([result.grant]);
    expect(await ctx.perm.query(NOTIFY)).toEqual([result.grant]);
    expect(await ctx.perm.query({ permission: "log:read" })).toEqual([]);
    expect(await ctx.perm.query()).toEqual([result.grant]);
    expect(host.calls.map((call) => [call.method, call.params])).toEqual([
      ["perm.request", { permission: NOTIFY, reason: "to say hello", duration: "session" }],
      ["perm.query", { permission: NOTIFY }],
      ["perm.query", { permission: { permission: "log:read" } }],
      ["perm.query", {}],
    ]);
  });

  it("a refusal is a result, not an error", async () => {
    const { host, ctx } = await mounted({ prompt: () => false });
    await expect(ctx.perm.request(NOTIFY, "to say hello")).resolves.toEqual({ granted: false });
    expect(host.grants).toEqual([]);
  });
});
