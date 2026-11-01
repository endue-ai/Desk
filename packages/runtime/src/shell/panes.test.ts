import { describe, expect, it } from "vitest";
import { paneViews } from "./panes";
import { Store, sampleState } from "./state";

function ctx() {
  const store = new Store(sampleState("en", 0));
  store.set({
    session: {
      1: {
        surfaces: [
          { id: "notes", plugin: "endue.notes", x: 120, y: 120, w: 400, h: 300, pinned: false },
          {
            id: "test.counter",
            plugin: "test.counter",
            x: 600,
            y: 120,
            w: 400,
            h: 300,
            pinned: false,
            panes: { kind: "view", id: "p1", view: "plugin:test.counter" },
          },
        ],
        eris: null,
        rail: { visible: true },
        drawer: { visible: true },
      },
    },
  });
  return {
    store,
    runtime: undefined as never,
    bridge: undefined as never,
    now: () => 0,
    wall: () => 0,
    tr: (k: string) => k,
  } as never;
}

describe("paneViews", () => {
  it("a pane showing a plugin's surface is not a host view: the runtime's surface counts once", () => {
    const views = paneViews(ctx());
    expect(views.ids()).toEqual(["notes/p1"]);
  });
});
