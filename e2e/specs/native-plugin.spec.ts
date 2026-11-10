// A native plugin on the compositor's desk (#59, ADR 0154): examples/plugin-native-wgpu, built for
// this machine by wdio.conf.ts, is a process of its own that the desk starts. It draws a wgpu scene
// into its window, which moves and snaps like any other window, and a kill of its process costs
// that window only: the desk keeps drawing every other surface, says the plugin died, and starts it
// again. The windows and the process are read through compositor_stats; the pointer is the
// compositor's own input (support/compositor.ts), since the screen may be locked.
import { browser, expect } from "@wdio/globals";
import { feed, shellCommand } from "../support/compositor";
import { shellReady } from "../support/desk";
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
});
