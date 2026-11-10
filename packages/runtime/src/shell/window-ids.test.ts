/**
 * Window ids are unique across desktops (#101): desk-wm names them (⌘N's `window-<n>` is the first
 * number no window on any desktop, no window placed but not drawn and no drawer item has;
 * crates/desk-wm/tests/ids.rs). The runtime reads the desk's ids from what desk-wm published, and
 * its closed list knows a window by its id alone.
 */
import { describe, expect, it, vi } from "vitest";
import { watchClosed } from "../eris-context/closed";
import { testWindowManager } from "../wm/testing";
import { takeDesk } from "../wm/view";
import { setDesktop, stash } from "./actions";
import { Store, sampleState } from "./state";
import { freeWindowId, windowIds } from "./window-ids";
import { closePane, newWindow, showInPane } from "./windows";

const epoch = Date.parse("2026-10-28T09:00:00.000Z");

function ctx() {
  const store = new Store({ ...sampleState("en", epoch), drawer: [] });
  const wm = testWindowManager();
  wm.connect((published) => takeDesk(store, published));
  const unmount = vi.fn((id: string) => void wm.edit([{ op: "release", id }]));
  return {
    store,
    wm,
    runtime: { shortcuts: { focused: null }, focusSurface() {}, plugins: { unmount } } as never,
    bridge: undefined as never,
    now: () => 1000,
    wall: () => epoch + 1000,
    tr: (key: string) => key,
  };
}

describe("window ids across desktops (#101)", () => {
  it("are the ones desk-wm names: on every desktop and in the drawer", async () => {
    const c = ctx();
    const one = await newWindow(c);
    await setDesktop(c, "2");
    const two = await newWindow(c);
    const three = await newWindow(c);
    await stash(c, three, "Three");
    const ids = windowIds(c.store.get());
    expect([...ids].sort()).toEqual([one, two, three].sort());
    expect(freeWindowId(ids)).toBe("window-4");
    expect(freeWindowId(new Set(["window-2"]))).toBe("window-1");
  });
});

describe("the closed list after desk.display.close-pane (#101)", () => {
  it("the window the last pane closed comes first, with windows on other desktops", async () => {
    const c = ctx();
    const log = watchClosed(c);
    await log.ready;
    const one = await newWindow(c);
    await showInPane(c, one, "p1", "notes");
    await setDesktop(c, "2");
    const two = await newWindow(c);
    await showInPane(c, two, "p1", "calendar");
    await closePane(c);
    expect(log.list().map((e) => e.id)).toEqual([two]);
    expect(log.list()[0]).toMatchObject({ desktop: "2", views: ["calendar"] });
  });
});
