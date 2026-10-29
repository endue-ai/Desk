import { describe, expect, it } from "vitest";
import { defineUiPlugin } from "./index";
import { createTestHost, type TestHostOptions } from "./testing/index";

async function mounted(options: Omit<TestHostOptions, "pluginId"> = {}) {
  const host = createTestHost({ pluginId: "example.a", ...options });
  const ctx = await defineUiPlugin({ mount() {} }, host.transport);
  return { host, ctx };
}

const SURFACE = { permission: "ui:surface" } as const;

describe("ctx.surface", () => {
  it("opens and closes a surface under ui:surface", async () => {
    const { host, ctx } = await mounted({ grants: [SURFACE] });
    const handle = await ctx.surface.open("prompt", {
      placement: "overlay",
      title: "Permission request",
    });
    expect(host.surfaces).toEqual([
      {
        handle,
        caller: "example.a",
        surface: "prompt",
        placement: "overlay",
        title: "Permission request",
      },
    ]);
    await ctx.surface.close(handle);
    expect(host.surfaces).toEqual([]);
    expect(host.calls.map((call) => [call.method, call.params])).toEqual([
      [
        "ui.surface.open",
        { surface: "prompt", placement: "overlay", title: "Permission request", scope: SURFACE },
      ],
      ["ui.surface.close", { handle, scope: SURFACE }],
    ]);
    expect(host.closed).toBe(false);
    await ctx.surface.close();
    expect(host.closed).toBe(true);
  });

  it("open is refused without the grant", async () => {
    const { host, ctx } = await mounted();
    await expect(ctx.surface.open("prompt")).rejects.toMatchObject({
      code: "permission_denied",
      permission: SURFACE,
    });
    expect(host.surfaces).toEqual([]);
  });
});
