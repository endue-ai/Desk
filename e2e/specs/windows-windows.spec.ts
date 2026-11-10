// Windows and panes (#82), the twin of packages/runtime/e2e/shell-windows.spec.ts "surfaces as
// windows" on the CEF desk: read only through desk.windows.list over desk.sock, driven by desk.*
// commands (⌘N is desk.display.new-surface, ⌘D desk.display.split-right, ⌘] focus-next) and the
// person's pointer and keys (support/gestures.ts). The profile's plugin windows are turned off first
// and each case starts on a desktop of its own and closes its windows, as the runtime e2e starts on
// an empty fixture.
// The keys and bindings cases of that file are the keys settings' (not the window manager's) and
// stay there.
import { browser, expect } from "@wdio/globals";
import { shellReady } from "../support/desk";
import { chord, click, drawerButtonAt, KEY, MOD, toolAt, type } from "../support/gestures";
import {
  byId,
  clearDesk,
  closeShellWindows,
  deskNow,
  freshDesktop,
  inUse,
  onScreen,
  openWindow,
  rectOf,
  run,
  topZ,
  until,
  windowNow,
  windowUntil,
} from "../support/windows";

const views = (id: string) => async () => (await windowNow(id)).panes.map((p) => p.view);
const inUsePane = async (id: string) => (await windowNow(id)).panes.find((p) => p.focused)?.id;

describe("windows: surfaces as windows (#82)", () => {
  before(async () => {
    await shellReady();
    await clearDesk();
  });
  beforeEach(async () => {
    await freshDesktop();
  });
  afterEach(async () => {
    await closeShellWindows();
  });

  it("a new window opens with a launcher, in use and on top; a choice fills it", async () => {
    const id = await openWindow();
    let desk = await deskNow();
    const win = byId(desk, id);
    expect(win).toMatchObject({ state: "normal", focused: true });
    expect(win?.panes).toEqual([
      { id: "p1", view: "launcher", title: "New surface", focused: true },
    ]);
    expect(win?.z).toBe(topZ(desk));
    await run("desk.shell.open-calendar");
    const filled = await windowUntil(id, (w) => w.panes[0]?.view === "calendar", "shows Calendar");
    expect(filled.panes).toEqual([
      { id: "p1", view: "calendar", title: "Calendar", focused: true },
    ]);
    // ⌘N again: another window, on top and in use; the first keeps its place below it.
    const two = await openWindow();
    expect(two).not.toBe(id);
    desk = await deskNow();
    expect(inUse(desk)?.id).toBe(two);
    expect(byId(desk, two)?.z).toBe(topZ(desk));
    expect(byId(desk, id)?.z).toBeLessThan(byId(desk, two)?.z ?? 0);
    expect(byId(desk, id)?.focused).toBeUndefined();
  });

  it("split right and split down: the new pane takes the focus, and the focus steps through the panes", async () => {
    const id = await openWindow();
    await run("desk.shell.open-notes");
    await run("desk.display.split-right");
    await windowUntil(id, (w) => w.panes.length === 2, "two panes");
    expect(await inUsePane(id)).toBe("p2");
    expect(await views(id)()).toEqual(["notes", "launcher"]);
    await run("desk.shell.open-calendar");
    await run("desk.display.split-down");
    await windowUntil(id, (w) => w.panes.length === 3, "three panes");
    expect(await inUsePane(id)).toBe("p3");
    await run("desk.shell.open-tomorrow");
    await windowUntil(id, (w) => w.panes[2]?.view === "tomorrow", "p3 shows Tomorrow");
    expect(await views(id)()).toEqual(["notes", "calendar", "tomorrow"]);
    // ⌘[ steps back through the panes and ⌘] forward. (Past the last pane the focus goes on to the
    // dock, an edge surface the runtime fixture does not have, so the steps stay inside.)
    await run("desk.display.focus-previous");
    await windowUntil(id, (w) => w.panes[1]?.focused === true, "p2 in use");
    await run("desk.display.focus-previous");
    await windowUntil(id, (w) => w.panes[0]?.focused === true, "p1 in use");
    expect((await windowNow(id)).panes[0]?.title).toBe("Notes");
    await run("desk.display.focus-next");
    await windowUntil(id, (w) => w.panes[1]?.focused === true, "p2 in use again");
  });

  it("closing the pane in use leaves the other, and closing the last pane closes the window", async () => {
    const id = await openWindow();
    await run("desk.shell.open-notes");
    await run("desk.display.split-right");
    await windowUntil(id, (w) => w.panes.length === 2, "two panes");
    await run("desk.display.close-pane");
    const left = await windowUntil(id, (w) => w.panes.length === 1, "one pane left");
    expect(left.panes.map((p) => p.view)).toEqual(["notes"]);
    await run("desk.display.close-pane");
    await until((d) => !onScreen(d).some((w) => w.id === id), "the window closed");
  });

  it("a split window keeps its panes in the drawer and comes back with them", async () => {
    const id = await openWindow();
    await run("desk.shell.open-notes");
    await run("desk.display.split-right");
    const split = await windowUntil(id, (w) => w.panes.length === 2, "two panes");
    await click(toolAt(rectOf(split), "drawer"));
    const away = await until(
      (d) => d.windows.some((w) => w.id === id && w.hidden === true),
      "the window in the drawer",
    );
    const kept = away.windows.find((w) => w.id === id);
    expect(kept?.desktop).toBeUndefined();
    expect(kept?.z).toBeUndefined();
    expect(kept?.panes.map((p) => p.view)).toEqual(["notes", "launcher"]);
    expect(onScreen(away).some((w) => w.id === id)).toBe(false);
    // The drawer's button opens its list; the item put away last is the one before the button
    // (Shift+Tab), and Enter on its Raise brings the window back, split as it was.
    await click(drawerButtonAt(away.screen));
    await chord(KEY.shift, KEY.tab);
    await chord(KEY.enter);
    const back = await windowUntil(id, (w) => !w.hidden, "back on the desktop");
    expect(back.panes.map((p) => p.view)).toEqual(["notes", "launcher"]);
    expect(rectOf(back)).toEqual(rectOf(split));
  });

  it("typing in a pane is not a command, but chords still are", async () => {
    const id = await openWindow();
    await run("desk.shell.open-notes");
    const win = await windowUntil(id, (w) => w.panes[0]?.view === "notes", "shows Notes");
    // Into the note's text, then a plain "d": text, not ⌘D.
    await click({ x: win.x + 40, y: win.y + 80 });
    await type("d");
    await browser.pause(300);
    expect((await windowNow(id)).panes).toHaveLength(1);
    await chord(MOD, "d");
    await windowUntil(id, (w) => w.panes.length === 2, "⌘D split it");
  });
});
