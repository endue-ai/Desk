// System surfaces (#55, ADR 0160): the desk is the compositor and its system surfaces. What stays
// web of the shell runs in browsers with fixed callers (the desk's own page, the palette's window,
// floating Eris's), and the compositor places them in its system layer, above every window: the
// desk's parts whole, the dock's surface under them, an overlay's (the palette) over them. No plugin
// runs in the desk's page: the runtime keeps only each plugin surface's place there, and its plugin
// host talks to each plugin's own browser through the shell. Read through the shell's development
// command `compositor_stats` and the pages' DOM; keys and the pointer are fed as winit would hand them
// over.
import { browser, expect } from "@wdio/globals";
import { feed, inputState, keyPress, shellCommand } from "../support/compositor";
import { shellReady } from "../support/desk";
import { deskNow, onScreen } from "../support/windows";

interface Stats {
  system: {
    surfaces: Array<{ id: string; role: string; caller: string }>;
    parts: string[];
    /** The system layer back to front: the page's own plugin surfaces by plugin, its page as desk. */
    order: string[];
    plugins: Array<{ plugin: string; shown: boolean; layer: string }>;
  };
  surfaces: Record<string, { plugin: string; asleep: boolean; counts: { paints: number } }>;
  relayed: [number, number];
}

const stats = () => shellCommand<Stats>("compositor_stats");

/** The DevTools pages the desk has, by URL. */
async function pages(): Promise<string[]> {
  const main = await browser.getWindowHandle();
  const urls: string[] = [];
  for (const handle of await browser.getWindowHandles()) {
    await browser.switchToWindow(handle);
    urls.push(await browser.getUrl());
  }
  await browser.switchToWindow(main);
  return urls;
}

/** What the desk's own page holds where plugins show: frames, and surfaces' places by host. */
const pageHolds = () =>
  browser.execute(() => ({
    frames: document.querySelectorAll("iframe").length,
    places: [...document.querySelectorAll<HTMLElement>("[data-surface-host]")].map(
      (p) => p.dataset.surfaceHost ?? "",
    ),
  }));

describe("system surfaces: the desk is the compositor and its system surfaces", () => {
  before(async () => {
    await shellReady();
    await feed([{ type: "windowFocused", focused: true }]);
  });

  it("starts the compositor, then the desk's, the palette's and Eris's system surfaces, each calling as its window", async () => {
    const { system } = await stats();
    expect(system.surfaces).toEqual([
      { id: "desk", role: "Main", caller: "desk" },
      { id: "palette", role: "Palette", caller: "palette" },
      { id: "eris", role: "Eris", caller: "desk" },
    ]);
    const urls = await pages();
    for (const view of ["", "?view=palette", "?view=eris"]) {
      const page = `desk-app://app/index.html${view}`;
      expect(urls.some((u) => u === page)).toBe(true);
    }
  });

  it("holds no plugin in the desk's page: each plugin's page is a browser of its own, reached through the shell", async () => {
    const held = await pageHolds();
    expect(held.frames).toBe(0);
    expect(held.places.length).toBeGreaterThan(0);
    const s = await stats();
    const made = Object.keys(s.surfaces);
    expect(made.length).toBeGreaterThan(0);
    // Every surface the compositor made has its place in the page, and nothing else stands in.
    for (const host of made) expect(held.places).toContain(host);
    // Each plugin's page is a DevTools page of its own, on its surface's host.
    const urls = await pages();
    for (const host of made.filter((h) => !s.surfaces[h]?.asleep))
      expect(urls.some((u) => u.startsWith(`desk-plugin://${host}/`))).toBe(true);
    // The plugin host's messages went down to the plugins and back up, with no frame between.
    const [down, up] = s.relayed;
    expect(down).toBeGreaterThan(0);
    expect(up).toBeGreaterThan(0);
  });

  it("draws the desk's parts whole above the windows, and its own plugin surfaces in their layers", async () => {
    await browser.waitUntil(async () => (await stats()).system.parts.includes("desk.agents"), {
      timeoutMsg: "the agent bar was never drawn as a part of the system layer",
    });
    const { system } = await stats();
    for (const part of ["desk.profiles", "desk.desktops", "desk.agents"])
      expect(system.parts).toContain(part);
    const palette = system.plugins.find((p) => p.plugin === "desk.palette");
    expect(palette).toEqual({ plugin: "desk.palette", shown: false, layer: "overlay" });
  });

  it("puts the palette's overlay above every window and the desk's own surface: it paints there, takes the pointer, and Escape closes it", async () => {
    const win = onScreen(await deskNow()).find((w) => w.panes.some((p) => p.plugin));
    if (!win) throw new Error("no plugin window on screen");
    const at = { x: win.x + win.w / 2, y: win.y + win.h / 2 };
    const s = await stats();
    const palette = Object.entries(s.surfaces).find(([, x]) => x.plugin === "desk.palette")?.[0];
    if (!palette) throw new Error("the palette has no surface");
    expect(s.system.order).not.toContain("desk.palette");
    /** Whether the pointer at `point` reaches the palette's surface, the topmost under it. */
    const reaches = async (point: { x: number; y: number }) => {
      await feed([{ type: "pointerMoved", x: point.x, y: point.y }]);
      return (await inputState()).pointer.hearing[0] === palette;
    };
    expect(await reaches(at)).toBe(false);
    // Mod+K opens it as a person does: the compositor draws its surface over the desk's page, which
    // lies over every window.
    const mod = process.platform === "darwin" ? { meta: true } : { ctrl: true };
    await feed([
      { type: "modifiers", ...mod },
      ...keyPress("k", "KeyK", "k"),
      { type: "modifiers" },
    ]);
    await browser.waitUntil(
      async () => {
        const order = (await stats()).system.order;
        return order.includes("desk") && order.indexOf("desk.palette") > order.indexOf("desk");
      },
      { timeoutMsg: "the palette's overlay was never drawn above the desk's system surface" },
    );
    // Made at the app's size while hidden, it paints once shown (a surface made at 1×1 never did).
    await browser.waitUntil(
      async () => ((await stats()).surfaces[palette]?.counts.paints ?? 0) > 0,
      {
        timeoutMsg: "the palette's surface never painted",
      },
    );
    await browser.waitUntil(() => reaches(at), {
      timeoutMsg: `the pointer over ${win.id} never reached the palette`,
    });
    await feed(keyPress("Escape", "Escape"));
    await browser.waitUntil(async () => !(await stats()).system.order.includes("desk.palette"), {
      timeoutMsg: "Escape did not close the palette",
    });
    expect(await reaches({ x: at.x + 1, y: at.y })).toBe(false);
  });
});
