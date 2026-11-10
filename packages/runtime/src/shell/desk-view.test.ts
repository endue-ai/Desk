// What Eris sees (ADR 0109, ADR 0124): desk-wm answers the windows and the desktops
// (`Desk::snapshot_seen`, crates/desk-wm/tests/desk.rs `the_snapshot`) with the titles and the
// frames' states the runtime tells it; the closed windows are the runtime's. These run the runtime's
// half on desk-wm as WebAssembly.
import { describe, expect, it } from "vitest";
import { watchClosed } from "../eris-context/closed";
import { testWindowManager } from "../wm/testing";
import type { DrawerItem } from "../wm/types";
import { takeDesk } from "../wm/view";
import { openSurface, setDesktop } from "./actions";
import { deskSnapshot } from "./desk-view";
import { Store, sampleState } from "./state";
import { closeWindow, focusPane, newWindow, splitPane, toggleFloating } from "./windows";

const epoch = Date.parse("2026-10-28T09:00:00.000Z");
type Rect = { x: number; y: number; w: number; h: number };

/** The shell over desk-wm on a 1440 × 900 app; `frames` says how each plugin's frame is doing. */
function ctx(frames?: { state(id: string): string }) {
  const store = new Store({ ...sampleState("en", epoch), drawer: [] });
  const wm = testWindowManager();
  wm.connect((published) => takeDesk(store, published));
  return {
    store,
    wm,
    runtime: {
      shortcuts: { focused: null },
      focusSurface() {},
      plugins: { unmount() {} },
      ...(frames ? { frames } : {}),
    } as never,
    bridge: undefined as never,
    now: () => 1000,
    wall: () => epoch + 1000,
    tr: (key: string) => key,
  };
}
type Ctx = ReturnType<typeof ctx>;

/** Plugin surfaces handed over to the shell's windows, in slots from 0. */
const adopt = (c: Ctx, plugins: [string, string][]) =>
  c.wm.edit(plugins.map(([id, title]) => ({ op: "adopt", id, title })));

/** Window `id` of the desktop in front at `rect`, as a drag leaves it. */
const move = (c: Ctx, id: string, rect: Rect) =>
  c.wm.edit([{ op: "set-geometry", geometry: { id, ...rect } }]);

/** A window put away in the drawer, as a saved session brings it back. */
const away = (id: string, plugin: string, rect: Rect): DrawerItem => ({
  id: `surface-${id}`,
  kind: "surface",
  name: "Mail",
  at: epoch,
  placement: { id, plugin, ...rect, pinned: false },
});

describe("the desk Eris sees", () => {
  it("names each window's plugin and title, where it is on screen, front to back", async () => {
    const c = ctx();
    await adopt(c, [
      ["endue.git", "Git"],
      ["endue.notes", "Notes"],
    ]);
    await move(c, "endue.notes", { x: 40, y: 60, w: 600, h: 400 });
    await move(c, "endue.git", { x: 700, y: 60, w: 680, h: 760 });
    await focusPane(c, "endue.git");
    const desk = await deskSnapshot(c);
    expect(desk.screen).toEqual({ w: 1440, h: 900 });
    const ids = desk.windows.map((w) => w.id);
    expect(ids[0]).toBe("endue.git");
    const git = desk.windows[0];
    expect(git).toMatchObject({ x: 700, y: 60, w: 680, h: 760, focused: true });
    expect(git?.panes).toEqual([
      { id: "p1", view: "plugin:endue.git", plugin: "endue.git", title: "Git", focused: true },
    ]);
    const notes = desk.windows.find((w) => w.id === "endue.notes");
    expect(notes).toMatchObject({
      x: 40,
      y: 60,
      w: 600,
      h: 400,
      panes: [{ plugin: "endue.notes" }],
    });
    expect(notes).not.toHaveProperty("focused");
  });

  it("says which plugin's frame stopped answering, late or stopped, and nothing of one that answers", async () => {
    const states: Record<string, string> = { "endue.git": "late", "endue.mail": "stopped" };
    const c = ctx({ state: (id) => states[id] ?? "responding" });
    await adopt(c, [
      ["endue.git", "Git"],
      ["endue.notes", "Notes"],
      ["endue.mail", "Mail"],
    ]);
    const desk = await deskSnapshot(c);
    const panes = Object.fromEntries(desk.windows.map((w) => [w.id, w.panes[0]]));
    expect(panes["endue.git"]).toMatchObject({ plugin: "endue.git", responsiveness: "late" });
    expect(panes["endue.mail"]).toMatchObject({ plugin: "endue.mail", responsiveness: "stopped" });
    expect(panes["endue.notes"]).not.toHaveProperty("responsiveness");
  });

  it("puts floating windows in front and says they float", async () => {
    const c = ctx();
    await adopt(c, [
      ["endue.git", "Git"],
      ["endue.notes", "Notes"],
    ]);
    await move(c, "endue.notes", { x: 40, y: 60, w: 600, h: 400 });
    await toggleFloating(c, "endue.notes");
    const desk = await deskSnapshot(c);
    expect(desk.windows[0]).toMatchObject({ id: "endue.notes", floating: true });
  });

  it("lists every pane of a split window, the one in use marked, and a launcher by its title", async () => {
    const c = ctx();
    const id = await newWindow(c);
    await splitPane(c, "row");
    const desk = await deskSnapshot(c);
    const window = desk.windows.find((w) => w.id === id);
    expect(window?.focused).toBe(true);
    expect(window?.panes).toHaveLength(2);
    expect(window?.panes.every((p) => p.view === "launcher" && !p.plugin)).toBe(true);
    expect(window?.panes.filter((p) => p.focused)).toHaveLength(1);
    // The title is the runtime's copy, which it tells desk-wm.
    expect(window?.panes[0]?.title).toBe("launcherTitle");
  });

  it("names windows put away in the drawer last, as hidden, and drops a closed one", async () => {
    const c = ctx();
    await openSurface(c, "calendar");
    const mail = { x: 200, y: 120, w: 560, h: 400 };
    await c.wm.edit([{ op: "drawer", items: [away("mail", "endue.mail", mail)] }]);
    const desk = await deskSnapshot(c);
    expect(desk.windows[0]).toMatchObject({ id: "calendar" });
    const last = desk.windows.at(-1);
    expect(last).toMatchObject({ id: "mail", hidden: true, w: 560, h: 400 });
    expect(last).not.toHaveProperty("focused");
    const id = await newWindow(c);
    await closeWindow(c, id);
    expect((await deskSnapshot(c)).windows.some((w) => w.id === id)).toBe(false);
  });
});

describe("every desktop and the windows closed recently (ADR 0124)", () => {
  it("carries every desktop's windows, those of the one in front first, and marks it", async () => {
    const c = ctx();
    await openSurface(c, "calendar");
    await setDesktop(c, "2");
    await openSurface(c, "notes");
    await c.wm.edit([{ op: "pan", desktop: "1", to: { x: -100, y: 0 } }]);
    const desk = await deskSnapshot(c);
    const still = { x: 0, y: 0 };
    expect(desk.desktops).toEqual([
      { id: "1", name: "1", pan: { x: -100, y: 0 } },
      { id: "2", name: "2", current: true, pan: still },
      { id: "3", name: "3", pan: still },
      { id: "4", name: "4", pan: still },
    ]);
    expect(desk.windows.map((w) => [w.id, w.desktop])).toEqual([
      ["notes", "2"],
      ["calendar", "1"],
    ]);
    expect(desk.windows[0]).toMatchObject({ focused: true });
    // Where it is when its desktop is in front: that desktop's pan, not the one in front's.
    expect(desk.windows[1]).toMatchObject({ x: 20, y: 240, w: 560, h: 400 });
    expect(desk.windows[1]).not.toHaveProperty("focused");
  });

  it("names a plugin window in its slot once, on the desktop in front, and the drawer's with none", async () => {
    const c = ctx();
    await adopt(c, [["endue.git", "Git"]]);
    const mail = { x: 0, y: 0, w: 400, h: 300 };
    await c.wm.edit([{ op: "drawer", items: [away("mail", "endue.mail", mail)] }]);
    const desk = await deskSnapshot(c);
    expect(desk.windows.map((w) => [w.id, w.desktop])).toEqual([
      ["endue.git", "1"],
      ["mail", undefined],
    ]);
    expect(desk.windows[1]).toMatchObject({ hidden: true });
  });

  it("carries the windows closed recently, the last first, with where they were and when", async () => {
    const c = ctx();
    const log = watchClosed(c);
    await log.ready;
    await setDesktop(c, "2");
    await openSurface(c, "notes");
    await move(c, "notes", { x: 500, y: 100, w: 400, h: 300 });
    await closeWindow(c, "notes");
    await openSurface(c, "calendar");
    await closeWindow(c, "calendar");
    const desk = await deskSnapshot(c);
    expect(desk.closed?.map((w) => w.id)).toEqual(["calendar", "notes"]);
    expect(desk.closed?.[1]).toEqual({
      id: "notes",
      title: "surfaceNotes",
      desktop: "2",
      x: 500,
      y: 100,
      w: 400,
      h: 300,
      closedAt: new Date(epoch + 1000).toISOString(),
    });
    const fresh = { store: new Store(sampleState("en", epoch)), wm: testWindowManager() };
    expect((await deskSnapshot(fresh)).closed).toEqual([]);
  });
});
