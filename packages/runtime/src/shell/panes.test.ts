import { describe, expect, it } from "vitest";
import { testWindowManager } from "../wm/testing";
import { takeDesk } from "../wm/view";
import { paneViews } from "./panes";
import { Store, sampleState } from "./state";

/** A desk whose desktop in front has a notes window and a plugin's window, as desk-wm holds it. */
async function ctx() {
  const store = new Store(sampleState("en", 0));
  const wm = testWindowManager();
  wm.connect((published) => takeDesk(store, published));
  const at = { y: 120, w: 400, h: 300, pinned: false };
  await wm.edit([
    { op: "place", placement: { id: "notes", plugin: "endue.notes", x: 120, ...at } },
    {
      op: "place",
      placement: {
        id: "test.counter",
        plugin: "test.counter",
        x: 600,
        ...at,
        panes: { kind: "view", id: "p1", view: "plugin:test.counter" },
      },
    },
  ]);
  return {
    store,
    wm,
    runtime: undefined as never,
    bridge: undefined as never,
    now: () => 0,
    wall: () => 0,
    tr: (k: string) => k,
  } as never;
}

describe("paneViews", () => {
  it("a pane showing a plugin's surface is not a host view: the runtime's surface counts once", async () => {
    const views = paneViews(await ctx());
    expect(views.ids()).toEqual(["notes/p1"]);
  });

  it("names the plugin surface the window in use shows, as the window manager has it (issue 163)", async () => {
    const c = (await ctx()) as unknown as {
      store: Store;
      wm: ReturnType<typeof testWindowManager>;
    };
    const views = paneViews(c as never);
    const heard: Array<string | null | undefined> = [];
    const off = views.onChange(() => heard.push(views.inUse?.()));
    // The runtime handed the plugin's surface over: its window shows it.
    await c.wm.edit([{ op: "adopt", id: "test.counter", title: "Counter" }]);
    await c.wm.edit([{ op: "focus", window: "test.counter" }]);
    expect(views.inUse?.()).toBe("test.counter");
    expect(views.focused()).toBeNull();
    await c.wm.edit([{ op: "focus", window: "notes" }]);
    expect(views.inUse?.()).toBeNull();
    expect(views.focused()).toBe("notes/p1");
    expect(heard).toContain("test.counter");
    off();
  });
});
