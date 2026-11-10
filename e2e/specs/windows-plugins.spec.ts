// Plugin windows (#82), the twin of packages/runtime/e2e/shell-plugins.spec.ts on the CEF desk: two
// UI plugins' windows (e2e.hello, whose Count lives in its frame and in desk:state, and
// endue.notes) through one window manager: slots, resize, drag, snap, fill, the drawer, turning a
// plugin off and on, showing a surface, the focus cycle and the live budget (ADR 0134). Windows are
// read through desk.windows.list; a plugin's own content (its Count) is read inside its frame, as
// the person reads it, never the window manager's chrome.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { inFrame, press, shellReady } from "../support/desk";
import { HOME_VAR } from "../support/driver";
import { chord, click, drag, gripAt, KEY, TITLE_BAR, titleAt, toolAt } from "../support/gestures";
import { difference, settled } from "../support/pixels";
import {
  byId,
  call,
  clearDesk,
  closeShellWindows,
  deskNow,
  freshDesktop,
  inUse,
  onScreen,
  openWindow,
  partOf,
  rectOf,
  run,
  until,
  type Window,
  windowNow,
  windowUntil,
} from "../support/windows";

const HELLO = "e2e.hello";
const NOTES = "endue.notes";
const SCOPE = { permission: "plugin:manage" };

/** Hello's count, read in its frame. */
const count = () => inFrame(HELLO, () => $("[data-testid=count]").getText());
/** Press Count in Hello's frame `n` times. */
async function countUp(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await inFrame(HELLO, () => press("button"));
}
/**
 * Show a plugin's surface (desk.display.show), in front and in use. Asked again until it is: a
 * plugin still mounting after a relaunch answers "opening" first.
 */
async function show(plugin: string): Promise<Window> {
  let shown: Window | undefined;
  await browser.waitUntil(
    async () => {
      await run("desk.display.show", { plugin });
      const w = byId(await deskNow(), plugin);
      shown = w?.focused === true && !w.hidden ? w : undefined;
      return shown !== undefined;
    },
    { timeout: 15_000, interval: 300, timeoutMsg: `${plugin} is not shown and in use` },
  );
  return shown as Window;
}

/**
 * A window's frame, its left columns under the title bar: in sight wherever its slot put it (the
 * bars float over its right part), and away from the title bar the pointer rests on after a drag.
 */
const leftOf = (w: Window) => ({ x: w.x, y: w.y + TITLE_BAR, w: 180, h: w.h - TITLE_BAR });

describe("plugins: plugin windows in the window manager (#82)", () => {
  before(async () => {
    await shellReady();
    await clearDesk([HELLO, NOTES]);
  });
  beforeEach(async () => {
    await freshDesktop();
  });
  afterEach(async () => {
    await closeShellWindows();
  });

  it("each plugin window opens in a slot of its own, one pane showing its plugin", async () => {
    const desk = await until(
      (d) => [HELLO, NOTES].every((id) => onScreen(d).some((w) => w.id === id)),
      "both plugin windows on the desktop",
    );
    const [hello, notes] = [byId(desk, HELLO), byId(desk, NOTES)];
    expect(hello).toMatchObject({ state: "normal" });
    expect(hello?.panes).toEqual([
      { id: "p1", view: `plugin:${HELLO}`, plugin: HELLO, title: "E2E Hello" },
    ]);
    expect(notes?.panes[0]).toMatchObject({ view: `plugin:${NOTES}`, plugin: NOTES });
    // Slots are one size, each its own place.
    expect({ w: hello?.w, h: hello?.h }).toEqual({ w: notes?.w, h: notes?.h });
    expect(rectOf(hello as Window)).not.toEqual(rectOf(notes as Window));
  });

  it("its title bar moves it and the resize grip resizes it; the frame keeps its state", async () => {
    const win = await show(HELLO);
    await countUp(1);
    const kept = await count();
    const notes = await windowNow(NOTES);
    const { w } = (await deskNow()).screen;
    const before = await settled(w);
    // Its slot reaches past the right edge: moved left, all of it is in sight.
    const from = titleAt(rectOf(win));
    await drag(from, { x: from.x - 500, y: from.y + 60 });
    const moved = await windowUntil(HELLO, (x) => x.x !== win.x, "moved");
    expect(rectOf(moved)).toEqual({ ...rectOf(win), x: win.x - 500, y: win.y + 60 });
    // Never loaded again: the same picture at its new place, the same count in its frame.
    const after = await settled(w);
    expect(difference(after, leftOf(moved), before, leftOf(win), { inset: 4 })).toBeLessThan(0.005);
    expect(await count()).toBe(kept);
    const grip = gripAt(rectOf(moved), "se");
    await drag(grip, { x: grip.x - 60, y: grip.y - 100 });
    const resized = await windowUntil(HELLO, (x) => x.w !== moved.w, "resized");
    expect(rectOf(resized)).toEqual({ ...rectOf(moved), w: moved.w - 60, h: moved.h - 100 });
    expect(await count()).toBe(kept);
    // The other window stayed where it was, at its size.
    expect(rectOf(await windowNow(NOTES))).toEqual(rectOf(notes));
  });

  it("dropped at the left edge it snaps to the left half; maximize fills the app and restores", async () => {
    const win = await show(HELLO);
    const desk = await deskNow();
    const from = titleAt(rectOf(win));
    await drag(from, { x: 10, y: from.y });
    const left = await windowUntil(HELLO, (w) => w.fill === "left", "the left half");
    expect(rectOf(left)).toEqual(partOf("left", desk.screen));
    await run("desk.display.maximize");
    const full = await windowUntil(HELLO, (w) => w.state === "filled", "filling the app");
    expect(rectOf(full)).toEqual({ x: 0, y: 0, w: desk.screen.w, h: desk.screen.h });
    await run("desk.display.maximize");
    const back = await windowUntil(HELLO, (w) => w.fill === "left", "back to the left half");
    expect(rectOf(back)).toEqual(partOf("left", desk.screen));
  });

  it("put in the drawer its window goes; shown again, the plugin is back with its state", async () => {
    const win = await show(HELLO);
    await countUp(1);
    const kept = await count();
    await click(toolAt(rectOf(win), "drawer"));
    const away = await until(
      (d) => d.windows.some((w) => w.id === HELLO && w.hidden === true),
      "Hello in the drawer",
    );
    expect(onScreen(away).some((w) => w.id === HELLO)).toBe(false);
    await show(HELLO);
    await browser.waitUntil(async () => (await count().catch(() => "")) === kept, {
      timeoutMsg: `Hello's count is not ${kept} again`,
    });
  });

  it("turned off its window goes and the other stays; turned on it comes back", async () => {
    const notes = await windowNow(NOTES);
    await call("plugin.setEnabled", { plugin: HELLO, enabled: false, scope: SCOPE });
    await until((d) => !d.windows.some((w) => w.id === HELLO), "Hello's window gone");
    expect(rectOf(await windowNow(NOTES))).toEqual(rectOf(notes));
    await call("plugin.setEnabled", { plugin: HELLO, enabled: true, scope: SCOPE });
    // Back where the desk keeps it (a desktop that placed it before, or its slot), and shown.
    await until((d) => d.windows.some((w) => w.id === HELLO && !w.hidden), "Hello's window back");
    await show(HELLO);
    await browser.waitUntil(
      async () =>
        (
          await inFrame(HELLO, () => $("[data-testid=bridge]").getText()).catch(() => "")
        ).startsWith("bridge: ok"),
      { timeoutMsg: "Hello's frame did not answer again" },
    );
  });

  it("a plugin that shows its surface comes in front with the focus, from the drawer too", async () => {
    const notes = await show(NOTES);
    const hello = await show(HELLO);
    const desk = await deskNow();
    expect(inUse(desk)?.id).toBe(HELLO);
    expect(byId(desk, HELLO)?.z ?? 0).toBeGreaterThan(byId(desk, NOTES)?.z ?? 0);
    expect(byId(desk, NOTES)?.focused).toBeUndefined();
    await click(toolAt(rectOf(hello), "drawer"));
    await until((d) => !onScreen(d).some((w) => w.id === HELLO), "Hello in the drawer");
    await show(HELLO);
    expect(rectOf(await windowNow(NOTES))).toEqual(rectOf(notes));
  });

  it("Control+Tab reaches a plugin window, which then says it is in use", async () => {
    const id = await openWindow();
    let desk = await deskNow();
    for (let step = 0; step < 6 && !inUse(desk)?.panes.some((p) => p.plugin); step++) {
      await chord(KEY.control, KEY.tab);
      desk = await deskNow();
    }
    const plugin = inUse(desk);
    expect([HELLO, NOTES]).toContain(plugin?.id);
    expect(byId(desk, id)?.focused).toBeUndefined();
  });

  it("past the live budget, the windows out of sight sleep, and one shown wakes with its state", async function () {
    this.timeout(180_000);
    // A profile with no window kept live out of sight (desk.surfaces.live 0), read at start.
    const home = process.env[HOME_VAR] ?? "";
    mkdirSync(join(home, ".desk/profiles"), { recursive: true });
    const profile = "name: E2E live 0\nsettings:\n  desk.surfaces.live: 0\n";
    writeFileSync(join(home, ".desk/profiles/e2e-live.yaml"), profile);
    await browser.reloadSession();
    await shellReady();
    await run("desk.profiles.switch", { id: "e2e-live" });
    await freshDesktop();
    // The switch put the windows it places nowhere in the drawer: both come back, then a window
    // filling the app hides them, and their frames go to sleep.
    await show(NOTES);
    await show(HELLO);
    await countUp(2);
    const kept = await count();
    const id = await openWindow();
    await run("desk.display.maximize");
    await windowUntil(id, (w) => w.state === "filled", "filling the app");
    const asleep = (d: Awaited<ReturnType<typeof deskNow>>, plugin: string) =>
      byId(d, plugin)?.panes[0]?.asleep === true;
    await until((d) => asleep(d, HELLO) && asleep(d, NOTES), "both plugin windows asleep", 20_000);
    // Shown, Hello wakes in front and its count comes back from desk:state.
    await show(HELLO);
    await until((d) => !asleep(d, HELLO), "Hello awake");
    await browser.waitUntil(async () => (await count().catch(() => "")) === kept, {
      timeoutMsg: `Hello's count is not ${kept} after it woke`,
    });
  });
});
