import { describe, expect, it } from "vitest";
import { layoutOf, openSurface, stash } from "./actions";
import { Store, sampleState } from "./state";
import { surfaceTitle } from "./titles";

const epoch = Date.parse("2026-10-28T09:00:00.000Z");

/** A store over the sample state and the copy keys as titles, with no runtime behind it. */
function ctx() {
  const store = new Store(sampleState("en", epoch));
  return {
    store,
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
  it("names a put-away surface after its title and dates it from the wall clock", () => {
    const c = ctx();
    openSurface(c, "calendar");
    stash(c, "calendar");
    expect(c.store.get().drawer[0]).toMatchObject({
      kind: "surface",
      name: "surfaceCalendar",
      at: epoch + 1000,
    });
  });
});

describe("agent screens", () => {
  it("open the second one offset from the first instead of on top of it", () => {
    const c = ctx();
    openSurface(c, "agent:ag_1");
    openSurface(c, "agent:ag_2");
    const [first, second] = layoutOf(c.store.get()).surfaces;
    expect(second?.x).toBe((first?.x ?? 0) + 24);
    expect(second?.y).toBe((first?.y ?? 0) + 24);
  });
});
