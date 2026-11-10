/**
 * Window ids are unique across desktops (#101): ⌘N's `window-<n>` is the first number no window on
 * any desktop, no window placed but not drawn and no drawer item has. Before, it looked at the
 * desktop in front only, so two desktops could each hold a `window-1`, and the drawer let go of one
 * put away while the other desktop placed its namesake (#4's rule): the window vanished.
 */
import { describe, expect, it, vi } from "vitest";
import { watchClosed } from "../eris-context/closed";
import { desktopsOf, edit, layoutOf, raise, setDesktop, stash, windowsOf } from "./actions";
import { Store, sampleState } from "./state";
import { closePane, newWindow, showInPane } from "./windows";

const epoch = Date.parse("2026-10-28T09:00:00.000Z");

function ctx() {
  const store = new Store({ ...sampleState("en", epoch), drawer: [] });
  const unmount = vi.fn((id: string) =>
    store.set((s) => ({ adopted: s.adopted.filter((a) => a.id !== id) })),
  );
  return {
    store,
    runtime: { shortcuts: { focused: null }, focusSurface() {}, plugins: { unmount } } as never,
    bridge: undefined as never,
    now: () => 1000,
    wall: () => epoch + 1000,
    tr: (key: string) => key,
  };
}

/** Every window id the desk holds: each desktop's layout and slots, then the drawer. */
function allIds(c: ReturnType<typeof ctx>): string[] {
  const s = c.store.get();
  return [
    ...desktopsOf(s).flatMap((d) => windowsOf(s, d.id).map((p) => p.id)),
    ...s.drawer.flatMap((d) => (d.placement ? [d.placement.id] : [])),
  ];
}

describe("window ids across desktops (#101)", () => {
  it("a new window on desktop 2 never takes an id desktop 1 uses", () => {
    const c = ctx();
    expect(newWindow(c)).toBe("window-1");
    setDesktop(c, "2");
    const two = newWindow(c);
    expect(two).toBe("window-2");
    setDesktop(c, "3");
    expect(newWindow(c)).toBe("window-3");
    const ids = allIds(c).filter((id) => id.startsWith("window-"));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("a window placed but not drawn (its plugin away for now) keeps its id", () => {
    const c = ctx();
    edit(c, (l) => ({
      ...l,
      surfaces: [
        {
          id: "window-1",
          plugin: "endue.window",
          x: 0,
          y: 0,
          w: 480,
          h: 320,
          pinned: false,
          panes: { kind: "view", id: "p1", view: "plugin:p.gone" },
        },
      ],
    }));
    expect(windowsOf(c.store.get()).some((p) => p.id === "window-1")).toBe(false);
    setDesktop(c, "2");
    expect(newWindow(c)).toBe("window-2");
  });

  it("put away on desktop 2, a window stays in the drawer and comes back on desktop 1", () => {
    const c = ctx();
    const one = newWindow(c);
    showInPane(c, one, "p1", "notes");
    setDesktop(c, "2");
    const two = newWindow(c);
    showInPane(c, two, "p1", "calendar");
    stash(c, two, "Calendar");
    const item = c.store.get().drawer.find((d) => d.placement?.id === two);
    expect(item?.placement?.panes).toEqual({ kind: "view", id: "p1", view: "calendar" });
    expect(layoutOf(c.store.get(), "2").surfaces).toEqual([]);
    setDesktop(c, "1");
    raise(c, item?.id ?? "");
    const back = layoutOf(c.store.get(), "1").surfaces;
    expect(back.map((p) => p.id)).toEqual([one, two]);
    expect(back.map((p) => p.panes)).toEqual([
      { kind: "view", id: "p1", view: "notes" },
      { kind: "view", id: "p1", view: "calendar" },
    ]);
    expect(c.store.get().drawer).toEqual([]);
  });

  it("put away on desktop 1 while desktop 2 is in front, a new window does not take its id", () => {
    const c = ctx();
    const one = newWindow(c);
    showInPane(c, one, "p1", "notes");
    stash(c, one, "Notes");
    setDesktop(c, "2");
    const two = newWindow(c);
    expect(two).not.toBe(one);
    showInPane(c, two, "p1", "calendar");
    // Brought back on desktop 2 beside the new one: both are there.
    raise(c, `surface-${one}`);
    expect(
      layoutOf(c.store.get(), "2")
        .surfaces.map((p) => p.id)
        .sort(),
    ).toEqual([one, two].sort());
  });
});

describe("the closed list after desk.display.close-pane (#101)", () => {
  it("the window the last pane closed comes first, with windows on other desktops", async () => {
    const c = ctx();
    const log = watchClosed(c);
    await log.ready;
    const one = newWindow(c);
    showInPane(c, one, "p1", "notes");
    setDesktop(c, "2");
    const two = newWindow(c);
    showInPane(c, two, "p1", "calendar");
    closePane(c);
    expect(log.list().map((e) => e.id)).toEqual([two]);
    expect(log.list()[0]).toMatchObject({ desktop: "2", views: ["calendar"] });
  });
});
