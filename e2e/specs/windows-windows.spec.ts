// Windows and what they show (#82), the twin of packages/runtime/e2e/shell-windows.spec.ts "surfaces as
// windows" on the CEF desk: read only through desk.windows.list over desk.sock, driven by desk.*
// commands (⌘N is desk.display.new-surface, ⌘D desk.display.new-tab, ⌘] focus-next) and the
// person's pointer and keys (support/gestures.ts). The profile's plugin windows are turned off first
// and each case starts on a desktop of its own and closes its windows, as the runtime e2e starts on
// an empty fixture.
// The keys and bindings cases of that file are the keys settings' (not the window manager's) and
// stay there.
import { browser, expect } from "@wdio/globals";
import { shellReady } from "../support/desk";
import { chord, click, drawerButtonAt, KEY, MOD, type } from "../support/gestures";
import {
  byId,
  clearDesk,
  closeShellWindows,
  deskNow,
  freshDesktop,
  inUse,
  onScreen,
  openWindow,
  putAway,
  rectOf,
  run,
  topZ,
  until,
  windowNow,
  windowUntil,
} from "../support/windows";

const views = (id: string) => async () => (await windowNow(id)).panes.map((p) => p.view);

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

  it("a window of the desk's own view takes no tab (ADR 0270)", async () => {
    const id = await openWindow();
    await run("desk.shell.open-notes");
    await windowUntil(id, (w) => w.panes[0]?.view === "notes", "shows Notes");
    await run("desk.display.new-tab");
    await browser.pause(300);
    expect(await views(id)()).toEqual(["notes"]);
  });

  it("closing the tab in use, a window's last, closes the window", async () => {
    const id = await openWindow();
    await run("desk.shell.open-notes");
    await windowUntil(id, (w) => w.panes[0]?.view === "notes", "shows Notes");
    await run("desk.display.close-tab");
    await until((d) => !onScreen(d).some((w) => w.id === id), "the window closed");
  });

  it("a window keeps what it shows in the drawer and comes back with it", async () => {
    const id = await openWindow();
    await run("desk.shell.open-notes");
    const shown = await windowUntil(id, (w) => w.panes[0]?.view === "notes", "shows Notes");
    await putAway(id);
    const away = await until(
      (d) => d.windows.some((w) => w.id === id && w.hidden === true),
      "the window in the drawer",
    );
    const kept = away.windows.find((w) => w.id === id);
    expect(kept?.desktop).toBeUndefined();
    expect(kept?.z).toBeUndefined();
    expect(kept?.panes.map((p) => p.view)).toEqual(["notes"]);
    expect(onScreen(away).some((w) => w.id === id)).toBe(false);
    // The drawer's button opens its list; the item put away last is the one before the button
    // (Shift+Tab), and Enter on its Raise brings the window back as it was.
    await click(drawerButtonAt(away.screen));
    await chord(KEY.shift, KEY.tab);
    await chord(KEY.enter);
    const back = await windowUntil(id, (w) => !w.hidden, "back on the desktop");
    expect(back.panes.map((p) => p.view)).toEqual(["notes"]);
    expect(rectOf(back)).toEqual(rectOf(shown));
  });

  it("typing in a window is not a command, but chords still are", async () => {
    const id = await openWindow();
    await run("desk.shell.open-notes");
    const win = await windowUntil(id, (w) => w.panes[0]?.view === "notes", "shows Notes");
    // Into the note's text, then a plain "n": text, not ⌘N.
    await click({ x: win.x + 40, y: win.y + 80 });
    const before = onScreen(await deskNow()).length;
    await type("n");
    await browser.pause(300);
    expect(onScreen(await deskNow())).toHaveLength(before);
    await chord(MOD, "n");
    await until((d) => onScreen(d).length === before + 1, "⌘N opened a window");
  });
});
