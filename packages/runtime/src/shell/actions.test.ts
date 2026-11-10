import { describe, expect, it } from "vitest";
import { testWindowManager } from "../wm/testing";
import { takeDesk } from "../wm/view";
import { openSurface, stash } from "./actions";
import { Store, sampleState } from "./state";
import { surfaceTitle } from "./titles";

const epoch = Date.parse("2026-10-28T09:00:00.000Z");

/** A store over the sample state, desk-wm under it and the copy keys as titles, no runtime. */
function ctx() {
  const store = new Store(sampleState("en", epoch));
  const wm = testWindowManager();
  wm.connect((published) => takeDesk(store, published));
  return {
    store,
    wm,
    runtime: undefined as never,
    bridge: undefined as never,
    now: () => 1000,
    wall: () => epoch + 1000,
    tr: (key: string, vars?: Record<string, string | number>) =>
      vars ? `${key} ${Object.values(vars).join(" ")}` : key,
  };
}

describe("surfaceTitle", () => {
  it("names the sample views, the launcher windows and the agent screens as people see them", () => {
    const c = ctx();
    expect(surfaceTitle(c, "calendar")).toBe("surfaceCalendar");
    expect(surfaceTitle(c, "window-1")).toBe("launcherTitle");
    c.store.set({ agents: [{ id: "ag_1", name: "Theo", slug: "theo", status: "idle" }] as never });
    expect(surfaceTitle(c, "agent:ag_1")).toBe("agentScreen Theo");
  });
});

describe("the drawer", () => {
  // Where it goes and how long it stays is desk-wm's (crates/desk-wm/tests/drawer.rs); the name
  // and the wall clock it is dated from are the runtime's.
  it("names a put-away surface after its title and dates it from the wall clock", async () => {
    const c = ctx();
    await openSurface(c, "calendar");
    await stash(c, "calendar");
    expect(c.store.get().drawer[0]).toMatchObject({
      kind: "surface",
      name: "surfaceCalendar",
      at: epoch + 1000,
    });
  });
});
