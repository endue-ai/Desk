// A native plugin on the compositor's desk (#59, ADR 0154): examples/plugin-native-wgpu, built for
// this machine by wdio.conf.ts, is a process of its own that the desk starts. It draws a wgpu scene
// into its window, which moves and snaps like any other window, and a kill of its process costs
// that window only: the desk keeps drawing every other surface, says the plugin died, and starts it
// again, its tree too while a screen reader runs (#146). The windows and the process are read
// through compositor_stats; the pointer is the compositor's own input (support/compositor.ts),
// since the screen may be locked. A keyboard goes through its window as through a web plugin's
// (#128): Control+Tab gives its window the keys (ADR 0192), Tab enters it at its first part and
// Shift+Tab at its last, its own Tab moves between its two parts, and past either end it hands the
// focus back to the desk, which goes on in the page's own order; the keys and the desk's
// accessibility tree (what a screen reader reads, `compositor_a11y`) follow each move.
import { browser, expect } from "@wdio/globals";
import { feed, inputState, keyPress, shellCommand } from "../support/compositor";
import { focusedSurface, shellReady } from "../support/desk";
import { partOf } from "../support/windows";

const PLUGIN = "example.native-wgpu";
const SURFACE = "main.example-native--wgpu";

type Quad = [number, number, number, number];

interface Surface {
  attached: number;
  refused: number;
  texture: [number, number] | null;
  loads: number | null;
  state: string;
}

interface Stats {
  browsers: number;
  native: Record<string, { pid: number | null; starts: number; deaths: number }>;
  surfaces: Record<string, Surface>;
  windows: Array<{ id: string; rect: Quad; panes: Array<{ plugin: string | null; rect: Quad }> }>;
}

interface A11y {
  focus: { role: string; label: string | null } | null;
  tree: unknown;
}

const stats = () => shellCommand<Stats>("compositor_stats");
const running = async () => (await stats()).native[PLUGIN];
const frames = async () => (await stats()).surfaces[SURFACE]?.attached ?? 0;

/** The native plugin's window, once the desk has placed it. */
async function nativeWindow(): Promise<Stats["windows"][number]> {
  let found: Stats["windows"][number] | undefined;
  await browser.waitUntil(
    async () => {
      found = (await stats()).windows.find((w) => w.panes.some((p) => p.plugin === PLUGIN));
      return found !== undefined;
    },
    { timeout: 20_000, timeoutMsg: "the native plugin has no window" },
  );
  if (!found) throw new Error("unreachable");
  return found;
}

/** The desk's accessibility tree, its focus where the keys are (ADR 0155). */
const a11y = (args: Record<string, unknown> = {}) => shellCommand<A11y>("compositor_a11y", args);
/** The surface the compositor gives the keys to. */
const keys = async () => (await inputState()).focused;
/** The tree's focus: the label of the node a screen reader is on. */
const focusLabel = async () => (await a11y()).focus?.label;

/** A press of Tab through the compositor, with these modifiers held. */
const tab = (mods: Record<string, boolean> = {}) =>
  feed([{ type: "modifiers", ...mods }, ...keyPress("Tab", "Tab", "\t"), { type: "modifiers" }]);

/** The page's focus is in the desk's own chrome, not in a plugin surface's place (ADR 0160). */
const inChrome = () =>
  browser.execute(
    () => !!document.activeElement && !document.activeElement.closest("[data-surface-host]"),
  );

const until = (check: () => Promise<boolean>, timeoutMsg: string) =>
  browser.waitUntil(check, { timeout: 10_000, timeoutMsg });

/** Drag the window's title bar from where it is by the pointer to `to`, and let go. */
async function dragTitle(rect: Quad, to: [number, number]) {
  const [x, y] = [rect[0] + 60, rect[1] + 18];
  const steps = [0.25, 0.5, 0.75, 1].map((t) => ({
    type: "pointerMoved",
    x: x + (to[0] - x) * t,
    y: y + (to[1] - y) * t,
  }));
  await feed([
    { type: "windowFocused", focused: true },
    { type: "pointerMoved", x, y },
    { type: "pointerButton", button: "left", pressed: true },
    ...steps,
  ]);
  await browser.pause(300);
  await feed([{ type: "pointerButton", button: "left", pressed: false }]);
}

describe("native plugin: a process of its own draws a window like any other (#59)", () => {
  before(async () => {
    await shellReady();
    await browser.waitUntil(async () => (await frames()) > 10, {
      timeout: 30_000,
      timeoutMsg: "the native plugin never attached a frame",
    });
  });

  it("draws its scene into its window from its own process, every frame refused by nobody", async () => {
    const native = await running();
    expect(native?.pid).toBeGreaterThan(0);
    expect(native?.deaths).toBe(0);
    const before = await frames();
    await browser.pause(1000);
    expect((await frames()) - before).toBeGreaterThan(10);
    const surface = (await stats()).surfaces[SURFACE];
    expect(surface?.refused).toBe(0);
    const win = await nativeWindow();
    const pane = win.panes.find((p) => p.plugin === PLUGIN);
    expect(surface?.texture?.[0]).toBeGreaterThanOrEqual(pane?.rect[2] ?? 1);
  });

  it("moves when dragged by its title and snaps to the left half at the app's edge", async () => {
    const win = await nativeWindow();
    await dragTitle(win.rect, [win.rect[0] - 80 + 60, win.rect[1] + 40 + 18]);
    await browser.waitUntil(
      async () => {
        const moved = (await nativeWindow()).rect;
        return (
          Math.abs(moved[0] - (win.rect[0] - 80)) <= 2 &&
          Math.abs(moved[1] - (win.rect[1] + 40)) <= 2
        );
      },
      { timeout: 5_000, timeoutMsg: "the window did not follow its title" },
    );
    const { width, height } = await browser.execute(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    await dragTitle((await nativeWindow()).rect, [3, height / 2]);
    // The left half as every window takes it (support/windows.ts, ADR 0128).
    const half = partOf("left", { w: width, h: height });
    let snapped: Quad | undefined;
    await browser.waitUntil(
      async () => {
        snapped = (await nativeWindow()).rect;
        const want = [half.x, half.y, half.w, half.h];
        return snapped.every((v, i) => Math.abs(v - (want[i] ?? 0)) <= 1);
      },
      {
        timeout: 5_000,
        timeoutMsg: `the window did not snap to the left half: ${snapped} for ${JSON.stringify(half)}`,
      },
    );
    // Its process hears the new size and draws at it.
    await browser.waitUntil(
      async () => ((await stats()).surfaces[SURFACE]?.texture?.[1] ?? 0) >= height - 50,
      { timeout: 5_000, timeoutMsg: "the plugin never drew at its new size" },
    );
  });

  it("a kill of its process costs its window only, and the desk starts it again", async () => {
    const pid = (await running())?.pid;
    if (!pid) throw new Error("no process");
    // A screen reader runs while it dies, so its new process must export its tree too: the Tab
    // case below reads its parts' focus from it (#146).
    await a11y({ activate: true });
    const before = await stats();
    const others = (s: Stats) =>
      Object.entries(s.surfaces)
        .filter(([surface]) => surface !== SURFACE)
        .map(([surface, { loads, state }]) => `${surface} ${loads} ${state}`)
        .sort();
    process.kill(pid, "SIGKILL");
    await browser.waitUntil(
      async () => {
        const now = await running();
        return now?.deaths === 1 && now.pid !== null && now.pid !== pid;
      },
      { timeout: 15_000, timeoutMsg: "the desk did not start the plugin again" },
    );
    const again = await frames();
    await browser.waitUntil(async () => (await frames()) > again + 10, {
      timeout: 10_000,
      timeoutMsg: "the new process draws nothing",
    });
    // Every other surface kept its renderer: none loaded again, slept or died.
    const after = await stats();
    expect(others(after)).toEqual(others(before));
    expect(after.browsers).toBe(before.browsers);
  });

  it("Tab enters it at its first part and leaves past its last, and Shift+Tab the other way (#128)", async () => {
    // The desk's tree, as a screen reader starts it: the plugin's parts and their focus are in it.
    await feed([{ type: "windowFocused", focused: true }]);
    await a11y({ activate: true });
    // Round the windows with the desk's focus cycling until the plugin's window has the focus.
    for (let presses = 0; presses < 40; presses++) {
      const before = await focusedSurface();
      await tab({ ctrl: true });
      await browser
        .waitUntil(async () => (await focusedSurface()) !== before, { timeout: 5_000 })
        .catch(() => undefined);
      if ((await focusedSurface()) === PLUGIN) break;
    }
    expect(await focusedSurface()).toBe(PLUGIN);
    // The window in use has the keys (ADR 0192): its place has the page's focus, no part of its
    // own has the plugin's yet.
    await until(
      async () => (await keys()) === SURFACE,
      "Control+Tab to the plugin's window left its keys with the desk's page",
    );
    expect(await inChrome()).toBe(false);

    // Tab: on to its first part, then its second; the tree follows.
    await tab();
    await until(async () => (await focusLabel()) === "Colour", "Tab never reached its first part");
    await tab();
    await until(
      async () => (await focusLabel()) === "Pause",
      "Tab never moved on to its second part",
    );
    // Past its last part: the plugin hands the focus back, and it goes on into the desk's chrome.
    await tab();
    await until(
      async () => (await keys()) !== SURFACE,
      "Tab past its last part kept the plugin's keys",
    );
    await until(inChrome, "the page's focus stayed in the plugin's place");
    await until(
      async () => (await focusLabel()) !== "Pause",
      "the tree's focus stayed on its part",
    );

    // Shift+Tab: back in at its last part, back to its first, then out before it.
    await tab({ shift: true });
    await until(
      async () => (await keys()) === SURFACE,
      "Shift+Tab never gave the plugin the keys again",
    );
    await until(
      async () => (await focusLabel()) === "Pause",
      "Shift+Tab never came back to its last part",
    );
    await tab({ shift: true });
    await until(
      async () => (await focusLabel()) === "Colour",
      "Shift+Tab never moved back to its first part",
    );
    await tab({ shift: true });
    await until(
      async () => (await keys()) !== SURFACE,
      "Shift+Tab before its first part kept the plugin's keys",
    );
    await until(inChrome, "the page's focus stayed in the plugin's place");
  });
});
