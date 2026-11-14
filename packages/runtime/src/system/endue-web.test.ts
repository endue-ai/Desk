// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShellCtx } from "../shell/context";
import { testDesk } from "../surface/endue/test-desk";
import { agentHome, agentPage } from "./endue";
import { showOnDesk } from "./endue-web";

type Run = (command: string, args?: unknown) => Promise<unknown>;

/** The test desk with commands that answer as `run` does; what was run, and what the system opened. */
function desk(run?: Run) {
  const { ctx, bridge } = testDesk();
  const ran: Array<[string, unknown]> = [];
  if (run) {
    const commands = {
      run: (command: string, args?: unknown) => {
        ran.push([command, args]);
        return run(command, args);
      },
    };
    Object.assign(ctx.runtime, { commands });
  }
  return { ctx: ctx as ShellCtx, ran, opened: () => bridge.fake.opened };
}

const STUDIO = agentPage("ag_miso");

describe("endue.ai's pages in a desk window (ADR 0223)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds an agent's own page and its Studio on endue.ai, the id one path segment", () => {
    expect(agentHome("ag_miso")).toBe("https://endue.ai/agent/ag_miso");
    expect(agentHome("ag/../x")).toBe("https://endue.ai/agent/ag%2F..%2Fx");
    expect(STUDIO).toBe("https://endue.ai/agent/ag_miso/studio");
  });

  it("opens the Browser and sends it to the page", async () => {
    const { ctx, ran, opened } = desk(async () => undefined);
    expect(await showOnDesk(ctx, STUDIO)).toBe("desk");
    expect(ran).toEqual([
      ["desk.plugins.open", { plugin: "endue.browser" }],
      ["endue.browser.go", { url: STUDIO }],
    ]);
    expect(opened()).toEqual([]);
  });

  it("asks again while the Browser's window is still loading", async () => {
    vi.useFakeTimers();
    let asked = 0;
    const { ctx, ran } = desk(async (command) => {
      if (command === "endue.browser.go" && ++asked < 3)
        throw new Error("endue.browser is not running");
    });
    const shown = showOnDesk(ctx, STUDIO);
    await vi.advanceTimersByTimeAsync(300);
    expect(await shown).toBe("desk");
    expect(ran.filter(([command]) => command === "endue.browser.go")).toHaveLength(3);
  });

  it("opens the page in the system browser where there is no Browser", async () => {
    const none = desk(async (command) => {
      if (command === "desk.plugins.open") throw new Error("no plugin endue.browser");
    });
    expect(await showOnDesk(none.ctx, STUDIO)).toBe("system");
    expect(none.opened()).toEqual([STUDIO]);
    expect(none.ran).toHaveLength(1);

    // A host whose runtime runs no commands: the same.
    const bare = desk();
    expect(await showOnDesk(bare.ctx, STUDIO)).toBe("system");
    expect(bare.opened()).toEqual([STUDIO]);
  });

  it("gives up on a Browser that never hears, and opens the system browser", async () => {
    vi.useFakeTimers();
    const { ctx, ran, opened } = desk(async (command) => {
      if (command === "endue.browser.go") throw new Error("endue.browser is not running");
    });
    const shown = showOnDesk(ctx, STUDIO);
    await vi.advanceTimersByTimeAsync(20 * 150);
    expect(await shown).toBe("system");
    expect(ran.filter(([command]) => command === "endue.browser.go")).toHaveLength(20);
    expect(opened()).toEqual([STUDIO]);
  });

  it("shows nothing but endue.ai's own origin", async () => {
    const { ctx, ran, opened } = desk(async () => undefined);
    await expect(showOnDesk(ctx, "https://endue.ai.example/agent/x")).rejects.toThrow(/endue.ai/);
    await expect(showOnDesk(ctx, "javascript:alert(1)")).rejects.toThrow();
    expect([ran, opened()]).toEqual([[], []]);
  });
});
