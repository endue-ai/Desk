import { describe, expect, it } from "vitest";
import { moveWindowTo } from "../desktops/actions";
import { desktopId, layoutOf, openSurface, setDesktop, stash } from "../shell/actions";
import { closeWindow, newWindow, showInPane } from "../shell/windows";
import { CLOSED_KEY, CLOSED_MAX, closedOf, watchClosed } from "./closed";
import { EPOCH, fakeDesk, memoryStorage, settle } from "./fixtures";
import { mountErisContext } from "./mount";

type Desk = ReturnType<typeof fakeDesk>;

/** Window `id` of the desktop in front at `rect`, as a drag leaves it in desk-wm. */
const move = (desk: Desk, id: string, rect: { x: number; y: number; w: number; h: number }) =>
  desk.wm.edit([{ op: "set-geometry", geometry: { id, ...rect } }]);

describe("the windows closed recently (ADR 0124)", () => {
  it("logs a window as it closes: its title, last place, desktop and when", async () => {
    const desk = fakeDesk();
    const log = watchClosed(desk.ctx);
    await log.ready;
    await setDesktop(desk.ctx, "2");
    await openSurface(desk.ctx, "calendar");
    await move(desk, "calendar", { x: 300, y: 200, w: 700, h: 500 });
    desk.tick(5000);
    await closeWindow(desk.ctx, "calendar");
    desk.tick(1000);
    await openSurface(desk.ctx, "notes");
    await closeWindow(desk.ctx, "notes");
    const [notes, calendar] = log.list();
    expect(notes).toMatchObject({ id: "notes", desktop: "2", at: EPOCH + 7000 });
    expect(calendar).toMatchObject({
      id: "calendar",
      title: "surfaceCalendar",
      plugins: [],
      desktop: "2",
      at: EPOCH + 6000,
      placement: { id: "calendar", x: 300, y: 200, w: 700, h: 500 },
    });
    expect(calendar).not.toHaveProperty("plugin");
  });

  it("logs a plugin's window at the place it had in its layout, not the slot it falls back to", async () => {
    const desk = fakeDesk();
    const log = watchClosed(desk.ctx);
    await log.ready;
    await setDesktop(desk.ctx, "2");
    desk.adopt("endue.git");
    await move(desk, "endue.git", { x: 40, y: 60, w: 600, h: 400 });
    desk.tick(6000);
    // desk-wm closes it (it shows in its slot again) and the runtime then unmounts its plugin.
    await closeWindow(desk.ctx, "endue.git");
    expect(log.list()[0]).toMatchObject({
      id: "endue.git",
      plugin: "endue.git",
      plugins: ["endue.git"],
      title: "endue.git",
      desktop: "2",
      at: EPOCH + 7000,
      placement: { x: 40, y: 60, w: 600, h: 400 },
    });
  });

  it("keeps the last CLOSED_MAX, the last closed first", async () => {
    const desk = fakeDesk();
    const log = watchClosed(desk.ctx);
    await log.ready;
    for (let n = 0; n < 25; n++) {
      await openSurface(desk.ctx, `agent:a${n}`);
      await closeWindow(desk.ctx, `agent:a${n}`);
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
    await openSurface(desk.ctx, "calendar");
    await openSurface(desk.ctx, "notes");
    await stash(desk.ctx, "notes");
    expect(await moveWindowTo(desk.ctx, "calendar", "3")).toBe(true);
    await setDesktop(desk.ctx, "2");
    expect(log.list()).toEqual([]);
    // Taking it out of the drawer for good closes it.
    await desk.wm.edit([{ op: "drawer", items: [] }]);
    expect(log.list().map((w) => w.id)).toEqual(["notes"]);
  });

  it("forgets a window that comes back, and logs nothing until the desk has started", async () => {
    let start = () => {};
    const ready = new Promise<void>((resolve) => {
      start = resolve;
    });
    const desk = fakeDesk();
    const log = watchClosed(desk.ctx, { ready });
    await openSurface(desk.ctx, "calendar");
    await closeWindow(desk.ctx, "calendar");
    expect(log.list()).toEqual([]);
    start();
    await log.ready;
    await openSurface(desk.ctx, "notes");
    await closeWindow(desk.ctx, "notes");
    expect(log.list().map((w) => w.id)).toEqual(["notes"]);
    await openSurface(desk.ctx, "notes");
    expect(log.list()).toEqual([]);
  });

  it("persists the log and reads it back on the next start", async () => {
    const storage = memoryStorage();
    const first = fakeDesk({ storage });
    const log = watchClosed(first.ctx, { storage });
    await log.ready;
    await openSurface(first.ctx, "calendar");
    await closeWindow(first.ctx, "calendar");
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
    await setDesktop(desk.ctx, "2");
    await openSurface(desk.ctx, "calendar");
    await move(desk, "calendar", { x: 300, y: 200, w: 700, h: 500 });
    await closeWindow(desk.ctx, "calendar");
    await setDesktop(desk.ctx, "1");
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
    await move(desk, "endue.git", { x: 100, y: 120, w: 500, h: 400 });
    await closeWindow(desk.ctx, "endue.git");
    expect(desk.store.get().adopted).toEqual([]);
    await desk.run("desk.windows.reopen");
    expect(desk.ran).toContainEqual({ id: "desk.plugins.open", args: { plugin: "endue.git" } });
    const s = desk.store.get();
    expect(s.focused).toBe("endue.git");
    expect(layoutOf(s).surfaces.find((p) => p.id === "endue.git")).toMatchObject({
      x: 100,
      y: 120,
      w: 500,
      h: 400,
    });
  });

  it("lists the closed windows for an agent, and refuses one that is not there", async () => {
    const { desk, log } = await mounted();
    await openSurface(desk.ctx, "notes");
    await closeWindow(desk.ctx, "notes");
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
    const id = await newWindow(desk.ctx);
    await showInPane(desk.ctx, id, "p1", "notes");
    await closeWindow(desk.ctx, id);
    // Later, as the person does: a new window takes the first free id.
    await settle();
    expect(await newWindow(desk.ctx)).toBe(id);
    const answer = (await desk.run("desk.windows.reopen", { id })) as { id: string };
    expect(answer.id).toBe("window-2");
    const surfaces = layoutOf(desk.store.get()).surfaces;
    expect(surfaces.find((p) => p.id === "window-2")?.panes).toMatchObject({ view: "notes" });
    expect(surfaces.find((p) => p.id === id)?.panes).toMatchObject({ view: "launcher" });
  });

  it("puts a window back in the log when its plugin cannot start", async () => {
    const { desk, log } = await mounted();
    desk.adopt("endue.gone");
    await move(desk, "endue.gone", { x: 10, y: 10, w: 300, h: 200 });
    await closeWindow(desk.ctx, "endue.gone");
    await expect(desk.run("desk.windows.reopen", { id: "endue.gone" })).rejects.toThrow();
    expect(layoutOf(desk.store.get()).surfaces.some((p) => p.id === "endue.gone")).toBe(false);
    expect(log?.list().map((w) => w.id)).toEqual(["endue.gone"]);
  });
});
