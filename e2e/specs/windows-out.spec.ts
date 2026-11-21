// Windows out of the canvas (#235, ADR 0205) on the CEF desk: a window pops out into an OS window of
// its own, docks back, closes with its OS window and comes back out after a restart. The same
// window to the desk all along: one id in desk.windows.list, the same plugin and its state.
//
// The machine running the specs may have its screen locked, so nothing here needs the OS to show
// or focus a window. The desk is read through desk.windows.list (the `out` flag and frame) and
// acted on through desk.* commands; the OS windows are read through the shell's development
// command (support/out.ts), which also presses a window's red button and moves it; a plugin's own
// content (its Count) is read in its page, a DevTools page of the windowed browser. What needs a
// person's eyes (Mission Control, another display or Space, a drag from Finder) is not here.
import { $, browser, expect } from "@wdio/globals";
import { shellCommand } from "../support/compositor";
import { inFrame, press, shellReady, waitForData } from "../support/desk";
import {
  type AppWindow,
  appWindow,
  appWindows,
  appWindowUntil,
  closeAppWindow,
  type Frame,
  isAt,
  moveAppWindow,
  outOf,
  windowMenu,
} from "../support/out";
import { hostOf } from "../support/pages";
import {
  byId,
  clearDesk,
  deskNow,
  front,
  onScreen,
  rectOf,
  run,
  until,
  type Window,
  windowUntil,
} from "../support/windows";

const HELLO = "e2e.hello";
const NOTES = "endue.notes";
/** The fixture whose surface is placed `floating`: the desk ships none. */
const FLOATING = "e2e.float";
const POP_OUT = "desk.windows.pop-out";
const DOCK = "desk.windows.dock";

/** Hello's count, read in its page. */
const count = () => inFrame(HELLO, () => $("[data-testid=count]").getText());
async function countUp(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await inFrame(HELLO, () => press("button"));
}
/** What Hello's page says of its bridge: `bridge: ok, …` once a call of its own was answered. */
const bridge = () => inFrame(HELLO, () => $("[data-testid=bridge]").getText());
/** Mark Hello's page, so a case can tell the page it reads later is a new one. */
const mark = () =>
  inFrame(HELLO, () =>
    browser.execute(() => {
      (window as { marked?: boolean }).marked = true;
    }),
  );
const marked = () =>
  inFrame(HELLO, () => browser.execute(() => (window as { marked?: boolean }).marked === true));

/** Show a plugin's window in front and in use, asked again while it is still mounting. */
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

/** The surfaces the compositor has a place for on the canvas, by host. */
async function drawn(): Promise<string[]> {
  type Surfaces = Record<string, { rect: number[] | null }>;
  const { surfaces } = await shellCommand<{ surfaces: Surfaces }>("compositor_stats");
  return Object.keys(surfaces).filter((host) => surfaces[host]?.rect);
}

/** Pop window `id` out and wait for its OS window; the window as the desk lists it then. */
async function popOut(id: string): Promise<Window> {
  await run(POP_OUT, { window: id });
  const out = await windowUntil(id, (w) => w.out !== undefined, "popped out");
  await appWindowUntil(id);
  return out;
}

/** A window that shows one plugin's surface and nothing else: the kind that pops out. */
const onePlugin = (w: Window) => w.panes.length === 1 && w.panes[0]?.plugin !== undefined;
/** An OS window whose browser opened. */
const opened = (w: AppWindow) => w.browser && w.frame !== null;

/** Where a case puts Hello's OS window: on any display, away from where the OS opens a window. */
const PLACE: Frame = { x: 140, y: 160, width: 800, height: 520 };

// Windows out of the canvas on Windows and Linux are the "every OS" track, out of #235's scope.
const mac = process.platform === "darwin";

(mac ? describe : describe.skip)(
  "out: a window pops out into an OS window of its own and docks back (#235)",
  () => {
    before(async () => {
      await shellReady();
    });

    it("the canvas is the default: no window is out and the shell holds no OS window", async () => {
      const desk = await deskNow();
      expect(desk.windows.filter((w) => w.out)).toEqual([]);
      expect(await appWindows()).toEqual([]);
    });

    it("every window of one plugin the Default profile lays out pops out and docks back where it was", async function () {
      this.timeout(180_000);
      await until((d) => byId(d, FLOATING) !== undefined, "the floating plugin's window");
      const before = onScreen(await deskNow()).filter(onePlugin);
      const ids = before.map((w) => w.id);
      expect(ids).toEqual(expect.arrayContaining([HELLO, NOTES, FLOATING]));

      for (const id of ids) await run(POP_OUT, { window: id });
      await until(
        (d) => ids.every((id) => byId(d, id)?.out),
        "every window out of the canvas",
        30_000,
      );
      await browser.waitUntil(
        async () => (await appWindows()).filter(opened).length === ids.length,
        {
          timeout: 30_000,
          timeoutMsg: "not every window out of the canvas has its OS window",
        },
      );
      expect((await appWindows()).map((w) => w.window).sort()).toEqual([...ids].sort());

      for (const id of ids) await run(DOCK, { window: id });
      const desk = await until(
        (d) => !d.windows.some((w) => w.out),
        "every window back on the canvas",
        30_000,
      );
      for (const w of before)
        expect([w.id, rectOf(byId(desk, w.id) as Window)]).toEqual([w.id, rectOf(w)]);
      await browser.waitUntil(async () => (await appWindows()).length === 0, {
        timeout: 30_000,
        timeoutMsg: "an OS window stayed open after its window docked",
      });

      await clearDesk([HELLO, NOTES]);
    });

    it("popped out, the window is in an OS window of its own with its state, the same window to the desk", async () => {
      const before = await show(HELLO);
      await countUp(2);
      await mark();
      const host = await hostOf(HELLO);
      expect(await drawn()).toContain(host);

      expect(await run(POP_OUT, { window: HELLO })).toEqual({ window: HELLO });
      const out = await windowUntil(HELLO, (w) => w.out !== undefined, "popped out");
      // One id, its desktop, its plugin, and the rect it docks back to; no place in the canvas's stack.
      expect(rectOf(out)).toEqual(rectOf(before));
      expect(out.desktop).toBe(before.desktop);
      expect(out.panes).toEqual(before.panes);
      expect(out.z).toBeUndefined();
      expect((await deskNow()).windows.filter((w) => w.id === HELLO)).toHaveLength(1);

      // Its OS window is open, titled as the window, and the desk lists it where the OS has it.
      const os = await appWindowUntil(HELLO);
      expect(os).toMatchObject({ window: HELLO, plugin: HELLO, title: "E2E Hello", surface: host });
      await windowUntil(HELLO, (w) => isAt(w, os?.frame as Frame), "listed where its OS window is");
      // The compositor no longer draws it on the canvas; the other window stays.
      await browser.waitUntil(async () => !(await drawn()).includes(host), {
        timeoutMsg: "the compositor still draws the window out of the canvas",
      });
      expect(byId(await deskNow(), NOTES)?.out).toBeUndefined();

      // A new page in the OS window, with what the plugin kept.
      await browser.waitUntil(async () => !(await marked()), {
        timeoutMsg: "the window out of the canvas kept its old page",
      });
      expect(await count()).toBe("2");
      // Its bridge goes through the desk as before.
      await browser.waitUntil(async () => (await bridge()).startsWith("bridge: ok"), {
        timeoutMsg: "the window out of the canvas has no bridge",
      });
    });

    it("out, it is one of the desk's windows: listed after the canvas's, focused by the desk's command", async () => {
      await show(NOTES);
      const desk = await deskNow();
      const ids = desk.windows.filter((w) => w.desktop === front(desk).id).map((w) => w.id);
      expect(ids.indexOf(NOTES)).toBeLessThan(ids.indexOf(HELLO));
      expect(byId(desk, HELLO)?.focused).toBeFalsy();

      await run("desk.windows.focus", { window: HELLO });
      const used = await windowUntil(HELLO, (w) => w.focused === true, "in use");
      expect(used.out).toBeDefined();
      expect(byId(await deskNow(), NOTES)?.focused).toBeFalsy();
      // Arranging the canvas leaves it out.
      await run("desk.windows.tile");
      expect((await appWindow(HELLO))?.browser).toBe(true);
      expect(byId(await deskNow(), HELLO)?.out).toBeDefined();
    });

    it("moved and resized, its OS frame follows in desk.windows.list", async () => {
      const moved = await moveAppWindow(HELLO, PLACE);
      expect(moved.out).toEqual(outOf(PLACE));
      expect((await appWindow(HELLO))?.frame).toEqual(PLACE);
    });

    it("out, it is listed in the Window menu by its title, and no floating window is", async () => {
      await browser.waitUntil(async () => (await windowMenu())?.includes("E2E Hello") === true, {
        timeoutMsg: "the Window menu does not list the window out of the canvas",
      });
      // Search Desk shown, then hidden again: the palette floats and is not listed.
      const toggle = () => shellCommand("compositor_window", { shortcut: "search" });
      await toggle();
      const listed = await windowMenu();
      await toggle();
      expect(listed).not.toContain("Search Desk");
      expect(listed).not.toContain("Eris is using your computer");
    });

    it("docked, it is back at its place on the canvas with its state", async () => {
      const out = byId(await deskNow(), HELLO) as Window;
      await countUp(1);
      await mark();
      expect(await run(DOCK, { window: HELLO })).toEqual({ window: HELLO });
      const back = await windowUntil(HELLO, (w) => w.out === undefined, "docked");
      expect(rectOf(back)).toEqual(rectOf(out));
      expect(back).toMatchObject({ focused: true, desktop: out.desktop });
      expect(back.z).toBeDefined();
      await appWindowUntil(HELLO, false);
      const host = await hostOf(HELLO);
      await browser.waitUntil(async () => (await drawn()).includes(host), {
        timeoutMsg: "the compositor does not draw the docked window",
      });
      await browser.waitUntil(async () => !(await marked()), {
        timeoutMsg: "the docked window kept the OS window's page",
      });
      expect(await count()).toBe("3");
      // A window not out does not dock.
      await expect(run(DOCK, { window: HELLO })).rejects.toThrow();
    });

    it("docked, it leaves the Window menu", async () => {
      await browser.waitUntil(async () => !(await windowMenu()).includes("E2E Hello"), {
        timeoutMsg: "the Window menu still lists the docked window",
      });
    });

    it("after a restart it comes back out where it was, with the canvas's windows on the canvas", async () => {
      await popOut(HELLO);
      await moveAppWindow(HELLO, PLACE);
      type Kept = { windows?: Record<string, { frames?: Record<string, Frame> }> };
      await waitForData(
        "app-windows.json",
        (kept) =>
          Object.values((kept as Kept | undefined)?.windows?.[HELLO]?.frames ?? {}).some(
            (f) => JSON.stringify(f) === JSON.stringify(PLACE),
          ),
        "Hello's place",
      );

      await browser.reloadSession();
      await shellReady();
      const out = await windowUntil(
        HELLO,
        (w) => w.out !== undefined,
        "out again after the restart",
      );
      const os = await appWindowUntil(HELLO);
      expect(os).toMatchObject({ window: HELLO, plugin: HELLO, frame: PLACE });
      await windowUntil(HELLO, (w) => isAt(w, PLACE), "listed where it was");
      expect(out.panes[0]?.plugin).toBe(HELLO);
      expect(byId(await deskNow(), NOTES)?.out).toBeUndefined();
      expect(await appWindows()).toHaveLength(1);
      // Its page is the OS window's, with its bridge: a start keeps no plugin's state, in or out.
      await browser.waitUntil(async () => (await bridge()).startsWith("bridge: ok"), {
        timeoutMsg: "the window out of the canvas has no bridge after the restart",
      });
    });

    it("closing its OS window closes the window", async () => {
      const host = await hostOf(HELLO);
      await closeAppWindow(HELLO);
      await until((d) => !d.windows.some((w) => w.id === HELLO), "Hello's window closed");
      await appWindowUntil(HELLO, false);
      expect(await drawn()).not.toContain(host);
      // The other window is where it was, and nothing else went out.
      const desk = await deskNow();
      expect(byId(desk, NOTES)).toBeDefined();
      expect(desk.windows.filter((w) => w.out)).toEqual([]);
    });
  },
);
