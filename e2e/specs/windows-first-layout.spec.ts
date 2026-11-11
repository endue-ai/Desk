// The first layout fits the app's first size (#158, #159, #160, #162): on a fresh desk at 1280×800
// the Default profile's plugin windows open in their slots inside the app, between the agent bar and
// the rail and above the dock, with every title bar's tools in sight; Tile and the spread keep
// clear of the dock too. Before, the slots of the 1440×900 reference frame put a third column past
// the right edge and the second row under the dock. Windows are read through desk.windows.list, the
// bars where the page draws them, the spread's cards from the accessibility tree.
import { browser, expect } from "@wdio/globals";
import { shellCommand } from "../support/compositor";
import { shellReady } from "../support/desk";
import { deskNow, onScreen, type Rect, rectOf, run, until } from "../support/windows";

/** Where the desk's bars are drawn: the agent bar's right edge, the rail's left, the dock's top. */
async function bars(): Promise<{ left: number; right: number; dock: number }> {
  return browser.execute(() => {
    const box = (s: string) => document.querySelector(s)?.getBoundingClientRect();
    const dock = box('#desk.shell .desk-surface[data-surface="endue.dock"]');
    return {
      left: box("#desk.shell .sidebar")?.right ?? 0,
      right: box("#desk.shell .rail")?.left ?? window.innerWidth,
      dock: dock?.top ?? window.innerHeight,
    };
  });
}

/** Every window of the desktop in front, by id, once their count holds still. */
async function settledWindows(): Promise<Record<string, Rect>> {
  let count = -1;
  const desk = await until((d) => {
    const now = onScreen(d).length;
    const still = now > 0 && now === count;
    count = now;
    return still;
  }, "the profile's windows are on the desk");
  return Object.fromEntries(onScreen(desk).map((w) => [w.id, rectOf(w)]));
}

/** The windows that reach under a bar: the agent bar, the rail or the dock. */
async function underBars(windows: Record<string, Rect>): Promise<string[]> {
  const at = await bars();
  return Object.entries(windows)
    .filter(([, r]) => r.x < at.left || r.x + r.w > at.right || r.y + r.h > at.dock)
    .map(([id, r]) => `${id} at ${JSON.stringify(r)} (bars ${JSON.stringify(at)})`);
}

/** The spread's cards on screen, once they have come to rest. */
async function cards(): Promise<number[][]> {
  interface Node {
    role: string;
    bounds?: number[];
    children: Node[];
  }
  const options = (n: Node | null | undefined): Node[] =>
    n ? [...(n.role === "list-box-option" ? [n] : []), ...n.children.flatMap(options)] : [];
  let last = "";
  let boxes: number[][] = [];
  await browser.waitUntil(
    async () => {
      const tree = (
        await shellCommand<{ tree: Node | null }>("compositor_a11y", { activate: true })
      ).tree;
      boxes = options(tree).map((o) => o.bounds ?? []);
      const now = JSON.stringify(boxes);
      const still = boxes.length > 0 && now === last;
      last = now;
      return still;
    },
    { timeout: 10_000, interval: 200, timeoutMsg: "the spread's cards come to rest" },
  );
  return boxes;
}

describe("the first layout at 1280×800 (#158)", () => {
  before(async () => {
    await shellReady();
  });

  it("every window opens inside the app, beside the bars and above the dock", async () => {
    const { screen } = await deskNow();
    expect(screen).toEqual({ w: 1280, h: 800 });
    const windows = await settledWindows();
    expect(Object.keys(windows).length).toBeGreaterThan(6);
    expect(await underBars(windows)).toEqual([]);
    // No two title bars at the same place.
    const corners = new Set(Object.values(windows).map((r) => `${r.x},${r.y}`));
    expect(corners.size).toBe(Object.keys(windows).length);
  });

  it("Tile keeps every window above the dock, and putting it back restores the slots", async () => {
    const before = await settledWindows();
    await run("desk.windows.tile");
    const tiled = await until(
      (d) => onScreen(d).some((w) => JSON.stringify(rectOf(w)) !== JSON.stringify(before[w.id])),
      "Tile moved the windows",
    );
    const arranged = Object.fromEntries(onScreen(tiled).map((w) => [w.id, rectOf(w)]));
    expect(await underBars(arranged)).toEqual([]);
    await run("desk.windows.restore-arrangement");
    await until(
      (d) => onScreen(d).every((w) => JSON.stringify(rectOf(w)) === JSON.stringify(before[w.id])),
      "the windows are back in their slots",
    );
  });

  it("the spread lays every card above the dock", async () => {
    const count = Object.keys(await settledWindows()).length;
    await run("desk.windows.spread");
    try {
      const boxes = await cards();
      expect(boxes).toHaveLength(count);
      const { dock } = await bars();
      const under = boxes.filter(([, y = 0, , h = 0]) => y + h > dock);
      expect(under).toEqual([]);
    } finally {
      await run("desk.windows.spread");
    }
  });
});
