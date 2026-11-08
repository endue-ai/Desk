import { describe, expect, it } from "vitest";
import { moveWindow } from "../desktops/move";
import { desktopId, layoutOf, moveSurface, openSurface, setDesktop, stash } from "../shell/actions";
import { closeWindow, newWindow, showInPane } from "../shell/windows";
import { CLOSED_KEY, CLOSED_MAX, closedOf, watchClosed } from "./closed";
import { EPOCH, fakeDesk, memoryStorage, settle } from "./fixtures";
import { mountErisContext } from "./mount";

describe("the windows closed recently (ADR 0124)", () => {
  it("logs a window as it closes: its plugin, title, last place, desktop and when", async () => {
    const desk = fakeDesk();
    const log = watchClosed(desk.ctx);
    await log.ready;
    setDesktop(desk.ctx, "2");
    openSurface(desk.ctx, "calendar");
    moveSurface(desk.ctx, "calendar", { x: 300, y: 200, w: 700, h: 500 });
    desk.adopt("endue.git");
    moveSurface(desk.ctx, "endue.git", { x: 40, y: 60, w: 600, h: 400 });
    desk.tick(5000);
    closeWindow(desk.ctx, "calendar");
    desk.tick(1000);
    closeWindow(desk.ctx, "endue.git");
    const [git, calendar] = log.list();
    expect(git).toMatchObject({
      id: "endue.git",
      plugin: "endue.git",
      plugins: ["endue.git"],
      title: "endue.git",
      desktop: "2",
      at: EPOCH + 7000,
      placement: { x: 40, y: 60, w: 600, h: 400 },
    });
    expect(calendar).toMatchObject({
      id: "calendar",
      title: "surfaceCalendar",
      desktop: "2",
      at: EPOCH + 6000,
      placement: { id: "calendar", x: 300, y: 200, w: 700, h: 500 },
    });
    expect(calendar).not.toHaveProperty("plugin");
  });

  it("keeps the last CLOSED_MAX, the last closed first", async () => {
    const desk = fakeDesk();
    const log = watchClosed(desk.ctx);
    await log.ready;
    for (let n = 0; n < 25; n++) {
      openSurface(desk.ctx, `agent:a${n}`);
      closeWindow(desk.ctx, `agent:a${n}`);
    }
    expect(CLOSED_MAX).toBe(20);
    expect(log.list()).toHaveLength(CLOSED_MAX);
    expect(log.list()[0]?.id).toBe("agent:a24");
    expect(log.list().at(-1)?.id).toBe("agent:a5");
  });

  it("does not count a window put in the drawer, moved to another desktop or left behind", async () => {
    const desk = fakeDesk();
    const log = watchClosed(desk.ctx);
    await log.ready;
    openSurface(desk.ctx, "calendar");
    openSurface(desk.ctx, "notes");
    stash(desk.ctx, "notes");
    const moved = moveWindow(desk.store.get(), "calendar", "3");
    desk.store.set(moved?.patch ?? {});
    setDesktop(desk.ctx, "2");
    expect(log.list()).toEqual([]);
    // Taking it out of the drawer for good closes it.
    desk.store.set({ drawer: [] });
    expect(log.list().map((w) => w.id)).toEqual(["notes"]);
  });

  it("forgets a window that comes back, and logs nothing until the desk has started", async () => {
    let start = () => {};
    const ready = new Promise<void>((resolve) => {
      start = resolve;
    });
    const desk = fakeDesk();
    const log = watchClosed(desk.ctx, { ready });
    openSurface(desk.ctx, "calendar");
    closeWindow(desk.ctx, "calendar");
    expect(log.list()).toEqual([]);
    start();
    await log.ready;
    openSurface(desk.ctx, "notes");
    closeWindow(desk.ctx, "notes");
    expect(log.list().map((w) => w.id)).toEqual(["notes"]);
    openSurface(desk.ctx, "notes");
    expect(log.list()).toEqual([]);
  });

  it("persists the log and reads it back on the next start", async () => {
    const storage = memoryStorage();
    const first = fakeDesk({ storage });
    const log = watchClosed(first.ctx, { storage });
    await log.ready;
    openSurface(first.ctx, "calendar");
    closeWindow(first.ctx, "calendar");
    await settle();
    expect(storage.saved.get(CLOSED_KEY)).toMatchObject({
      version: 1,
      closed: [{ id: "calendar", desktop: "1", at: EPOCH + 1000 }],
    });
    log.dispose();

    const next = fakeDesk({ storage });
    const again = watchClosed(next.ctx, { storage });
    await again.ready;
    expect(again.list()).toEqual(log.list());
    expect(closedOf(next.store)).toBe(again);
  });

  it("starts empty from a saved log that is not one", async () => {
    const storage = memoryStorage();
    storage.saved.set(CLOSED_KEY, { version: 1, closed: [{ id: 3 }, "x", { id: "a" }] });
    const desk = fakeDesk({ storage });
    const log = watchClosed(desk.ctx, { storage });
    await log.ready;
    expect(log.list()).toEqual([]);
  });
});

describe("desk.windows.closed and desk.windows.reopen", () => {
  async function mounted() {
    const desk = fakeDesk();
    const off = mountErisContext(desk.ctx);
    const log = closedOf(desk.store);
    await log?.ready;
    return { desk, off, log };
  }

  it("reopens a window where it was: its geometry, its desktop, in use", async () => {
    const { desk, log } = await mounted();
    setDesktop(desk.ctx, "2");
    openSurface(desk.ctx, "calendar");
    moveSurface(desk.ctx, "calendar", { x: 300, y: 200, w: 700, h: 500 });
    closeWindow(desk.ctx, "calendar");
    setDesktop(desk.ctx, "1");
    const answer = await desk.run("desk.windows.reopen", { id: "calendar" }, "eris");
    const s = desk.store.get();
    expect(desktopId(s)).toBe("2");
    expect(layoutOf(s, "2").surfaces.find((p) => p.id === "calendar")).toMatchObject({
      x: 300,
      y: 200,
      w: 700,
      h: 500,
    });
    expect(s.focused).toBe("calendar");
    expect(answer).toMatchObject({ id: "calendar", desktop: "2", x: 300, y: 200, w: 700, h: 500 });
    expect(log?.list()).toEqual([]);
  });

  it("starts the plugin a reopened window shows, and reopens the last closed when none is named", async () => {
    const { desk } = await mounted();
    desk.adopt("endue.git");
    moveSurface(desk.ctx, "endue.git", { x: 100, y: 120, w: 500, h: 400 });
    closeWindow(desk.ctx, "endue.git");
    expect(desk.store.get().adopted).toEqual([]);
    await desk.run("desk.windows.reopen");
    expect(desk.ran).toContainEqual({ id: "desk.plugins.open", args: { plugin: "endue.git" } });
    const s = desk.store.get();
    expect(layoutOf(s).surfaces.find((p) => p.id === "endue.git")).toMatchObject({
      x: 100,
      y: 120,
      w: 500,
      h: 400,
    });
    expect(s.focused).toBe("endue.git");
  });

  it("lists the closed windows for an agent, and refuses one that is not there", async () => {
    const { desk, log } = await mounted();
    openSurface(desk.ctx, "notes");
    closeWindow(desk.ctx, "notes");
    expect(desk.specs.get("desk.windows.closed")?.agent?.readOnly).toBe(true);
    expect(desk.specs.get("desk.windows.reopen")?.agent?.readOnly).toBeFalsy();
    const listed = (await desk.run("desk.windows.closed", {}, "eris")) as { closed: unknown[] };
    expect(listed.closed).toEqual([
      {
        id: "notes",
        title: "surfaceNotes",
        desktop: "1",
        x: 140,
        y: 260,
        w: 380,
        h: 300,
        closedAt: new Date(EPOCH + 1000).toISOString(),
      },
    ]);
    await expect(desk.run("desk.windows.reopen", { id: "mail" }, "eris")).rejects.toThrow(/mail/);
    expect(log?.list()).toHaveLength(1);
  });

  it("comes back under a new id when another window took its id and its panes allow it", async () => {
    const { desk } = await mounted();
    const id = newWindow(desk.ctx);
    showInPane(desk.ctx, id, "p1", "notes");
    closeWindow(desk.ctx, id);
    // Later, as the person does: a new window takes the first free id.
    await settle();
    expect(newWindow(desk.ctx)).toBe(id);
    const answer = (await desk.run("desk.windows.reopen", { id })) as { id: string };
    expect(answer.id).toBe("window-2");
    const surfaces = layoutOf(desk.store.get()).surfaces;
    expect(surfaces.find((p) => p.id === "window-2")?.panes).toMatchObject({ view: "notes" });
    expect(surfaces.find((p) => p.id === id)?.panes).toMatchObject({ view: "launcher" });
  });

  it("puts a window back in the log when its plugin cannot start", async () => {
    const { desk, log } = await mounted();
    desk.adopt("endue.gone");
    moveSurface(desk.ctx, "endue.gone", { x: 10, y: 10, w: 300, h: 200 });
    closeWindow(desk.ctx, "endue.gone");
    await expect(desk.run("desk.windows.reopen", { id: "endue.gone" })).rejects.toThrow();
    expect(layoutOf(desk.store.get()).surfaces.some((p) => p.id === "endue.gone")).toBe(false);
    expect(log?.list().map((w) => w.id)).toEqual(["endue.gone"]);
  });
});
