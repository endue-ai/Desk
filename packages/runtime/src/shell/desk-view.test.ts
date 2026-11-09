import { describe, expect, it } from "vitest";
import { watchClosed } from "../eris-context/closed";
import { moveSurface, openSurface, setDesktop } from "./actions";
import { deskSnapshot } from "./desk-view";
import { Store, sampleState } from "./state";
import { closeWindow, focusPane, newWindow, splitPane, toggleFloating } from "./windows";

const epoch = Date.parse("2026-10-28T09:00:00.000Z");
const SIZE = { vw: 1440, vh: 900 };

function ctx() {
  const store = new Store({ ...sampleState("en", epoch), drawer: [] });
  return {
    store,
    runtime: {
      shortcuts: { focused: null },
      focusSurface() {},
      plugins: { unmount() {} },
    } as never,
    bridge: undefined as never,
    now: () => 1000,
    wall: () => epoch + 1000,
    tr: (key: string) => key,
  };
}

/** Plugin surfaces handed over to the shell's windows, in slots from 0. */
function adopt(c: ReturnType<typeof ctx>, plugins: [string, string][]) {
  c.store.set({ adopted: plugins.map(([id, title], slot) => ({ id, title, slot })) });
}

describe("the desk Eris sees", () => {
  it("names each window's plugin and title, where it is on screen, front to back", () => {
    const c = ctx();
    adopt(c, [
      ["endue.git", "Git"],
      ["endue.notes", "Notes"],
    ]);
    moveSurface(c, "endue.notes", { x: 40, y: 60, w: 600, h: 400 });
    moveSurface(c, "endue.git", { x: 700, y: 60, w: 680, h: 760 });
    focusPane(c, "endue.git");
    const desk = deskSnapshot(c, SIZE);
    expect(desk.screen).toEqual({ w: 1440, h: 900 });
    const ids = desk.windows.map((w) => w.id);
    expect(ids[0]).toBe("endue.git");
    const git = desk.windows[0];
    expect(git).toMatchObject({ x: 700, y: 60, w: 680, h: 760, focused: true });
    expect(git?.panes).toEqual([
      { view: "plugin:endue.git", plugin: "endue.git", title: "Git", focused: true },
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

  it("says which plugin's frame stopped answering, late or stopped, and nothing of one that answers", () => {
    const c = ctx();
    const states: Record<string, string> = { "endue.git": "late", "endue.mail": "stopped" };
    const frames = { state: (id: string) => states[id] ?? "responding" };
    const seen = { ...c, runtime: { frames } as never };
    adopt(c, [
      ["endue.git", "Git"],
      ["endue.notes", "Notes"],
      ["endue.mail", "Mail"],
    ]);
    const panes = Object.fromEntries(
      deskSnapshot(seen, SIZE).windows.map((w) => [w.id, w.panes[0]]),
    );
    expect(panes["endue.git"]).toMatchObject({ plugin: "endue.git", responsiveness: "late" });
    expect(panes["endue.mail"]).toMatchObject({ plugin: "endue.mail", responsiveness: "stopped" });
    expect(panes["endue.notes"]).not.toHaveProperty("responsiveness");
  });

  it("puts floating windows in front and says they float", () => {
    const c = ctx();
    adopt(c, [
      ["endue.git", "Git"],
      ["endue.notes", "Notes"],
    ]);
    moveSurface(c, "endue.notes", { x: 40, y: 60, w: 600, h: 400 });
    toggleFloating(c, "endue.notes", { vw: SIZE.vw, vh: SIZE.vh });
    const desk = deskSnapshot(c, SIZE);
    expect(desk.windows[0]).toMatchObject({ id: "endue.notes", floating: true });
  });

  it("lists every pane of a split window, the one in use marked, and a launcher by its title", () => {
    const c = ctx();
    const id = newWindow(c);
    splitPane(c, "row");
    const desk = deskSnapshot(c, SIZE);
    const window = desk.windows.find((w) => w.id === id);
    expect(window?.focused).toBe(true);
    expect(window?.panes).toHaveLength(2);
    expect(window?.panes.every((p) => p.view === "launcher" && !p.plugin)).toBe(true);
    expect(window?.panes.filter((p) => p.focused)).toHaveLength(1);
    expect(window?.panes[0]?.title).toBe("launcherTitle");
  });

  it("names windows put away in the drawer last, as hidden, and drops a closed one", () => {
    const c = ctx();
    openSurface(c, "calendar");
    c.store.set({
      drawer: [
        {
          id: "mail",
          kind: "surface",
          name: "Mail",
          at: epoch,
          placement: {
            id: "mail",
            plugin: "endue.mail",
            x: 200,
            y: 120,
            w: 560,
            h: 400,
            pinned: false,
          },
        },
      ],
    });
    const desk = deskSnapshot(c, SIZE);
    expect(desk.windows[0]).toMatchObject({ id: "calendar" });
    const last = desk.windows.at(-1);
    expect(last).toMatchObject({ id: "mail", hidden: true, w: 560, h: 400 });
    expect(last).not.toHaveProperty("focused");
    const id = newWindow(c);
    closeWindow(c, id);
    expect(deskSnapshot(c, SIZE).windows.some((w) => w.id === id)).toBe(false);
  });
});

describe("every desktop and the windows closed recently (ADR 0124)", () => {
  it("carries every desktop's windows, those of the one in front first, and marks it", () => {
    const c = ctx();
    openSurface(c, "calendar");
    setDesktop(c, "2");
    openSurface(c, "notes");
    c.store.set((s) => ({ pan: { ...s.pan, "1": { x: -100, y: 0 } } }));
    const desk = deskSnapshot(c, SIZE);
    expect(desk.desktops).toEqual([
      { id: "1", name: "1" },
      { id: "2", name: "2", current: true },
      { id: "3", name: "3" },
      { id: "4", name: "4" },
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

  it("names a plugin window in its slot once, on the desktop in front, and the drawer's with none", () => {
    const c = ctx();
    adopt(c, [["endue.git", "Git"]]);
    c.store.set({
      drawer: [
        {
          id: "surface-mail",
          kind: "surface",
          name: "Mail",
          at: epoch,
          placement: {
            id: "mail",
            plugin: "endue.mail",
            x: 0,
            y: 0,
            w: 400,
            h: 300,
            pinned: false,
          },
        },
      ],
    });
    const desk = deskSnapshot(c, SIZE);
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
    setDesktop(c, "2");
    openSurface(c, "notes");
    moveSurface(c, "notes", { x: 500, y: 100, w: 400, h: 300 });
    closeWindow(c, "notes");
    openSurface(c, "calendar");
    closeWindow(c, "calendar");
    const desk = deskSnapshot(c, SIZE);
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
    expect(deskSnapshot({ store: new Store(sampleState("en", epoch)) }, SIZE).closed).toEqual([]);
  });
});
