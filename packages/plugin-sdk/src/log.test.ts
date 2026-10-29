import { describe, expect, it } from "vitest";
import { BridgeCallError, defineUiPlugin } from "./index";
import { createTestHost, type TestHostOptions } from "./testing/index";

async function mounted(options: Omit<TestHostOptions, "pluginId"> = {}) {
  const host = createTestHost({ pluginId: "example.a", ...options });
  const ctx = await defineUiPlugin({ mount() {} }, host.transport);
  return { host, ctx };
}

const LOG = { permission: "log:read" } as const;

describe("ctx.log", () => {
  it("write goes to the plugin's own channel", async () => {
    const { host, ctx } = await mounted({ now: () => "2026-10-30T09:00:00Z" });
    await expect(ctx.log.write("info", "mounted", { n: 1 })).resolves.toBeUndefined();
    expect(host.logged).toEqual([
      {
        at: "2026-10-30T09:00:00Z",
        channel: "example.a",
        level: "info",
        message: "mounted",
        fields: { n: 1 },
      },
    ]);
    expect(host.calls.map((call) => call.params)).toEqual([
      { level: "info", message: "mounted", fields: { n: 1 } },
    ]);
  });

  it("tail needs log:read", async () => {
    const bare = await mounted();
    const refused = await bare.ctx.log.tail().catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(BridgeCallError);
    expect(refused).toMatchObject({ code: "permission_denied", permission: LOG });

    const { host, ctx } = await mounted({ grants: [LOG] });
    await host.call("log.write", { level: "info", message: "from b" }, "example.b");
    await ctx.log.write("warn", "mine");
    const tail = await ctx.log.tail();
    expect(tail.map((entry) => [entry.channel, entry.message])).toEqual([
      ["example.b", "from b"],
      ["example.a", "mine"],
    ]);
    const own = await ctx.log.tail({ channel: "example.a" });
    expect(own.map((entry) => entry.message)).toEqual(["mine"]);
    expect(host.calls.filter((c) => c.method === "log.tail").map((c) => c.params)).toEqual([
      { scope: LOG },
      { channel: "example.a", scope: LOG },
    ]);
  });
});
