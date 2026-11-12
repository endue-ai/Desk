// Hover titles through the compositor (#156): every page is an off-screen browser, which draws no
// tooltip of its own, so the compositor draws a page's `title` near the pointer once the pointer
// has rested on it, in the theme's tooltip look, and puts it away on a move, and on a press until
// the pointer moves on (nothing shows where a dragged window is dropped). The desk's
// own page says its titles and its CSS cursor the same way; the controls it labels itself (the
// rail's and the arrange strip's tooltips) carry no `title`, so each is labelled once. The events
// are winit's, fed to the compositor window's own input entry (support/compositor.ts): the screen
// may be locked. What shows is the compositor's `compositor_input_state.tooltip`, and its frame.
import { browser, expect } from "@wdio/globals";
import { feed, INPUT, inputState, inSurface, raise } from "../support/compositor";
import { shellReady } from "../support/desk";
import { drag, titleAt } from "../support/gestures";
import { type Image, screenshot } from "../support/pixels";
import { deskNow, rectOf } from "../support/windows";

interface Shown {
  surface: string;
  text: string;
  rect: [number, number, number, number] | null;
}

interface Tooltip {
  titles: Record<string, string>;
  shown: Shown | null;
}

/** How long the pointer rests before a title shows (`compositor_window/tooltip.rs`). */
const DELAY = 500;

const tooltip = async () => ((await inputState()) as unknown as { tooltip: Tooltip }).tooltip;

/** The pointer comes to `at` as a hand does, from a little way off. */
const arrive = (at: [number, number]) =>
  feed([
    { type: "pointerMoved", x: at[0] - 14, y: at[1] - 9 },
    { type: "pointerMoved", x: at[0], y: at[1] },
  ]);

const press = () =>
  feed([
    { type: "pointerButton", button: "left", pressed: true },
    { type: "pointerButton", button: "left", pressed: false },
  ]);

async function showing(text: string): Promise<Shown> {
  await browser.waitUntil(async () => (await tooltip()).shown?.text === text, {
    timeout: 5_000,
    timeoutMsg: `"${text}" never showed`,
  });
  const shown = (await tooltip()).shown;
  if (!shown?.rect) throw new Error(`"${text}" shows without a box`);
  return shown;
}

/** The middle of the page element `selector` finds, where nothing of the page lies over it. */
const middle = (selector: string) =>
  browser.execute((selector: string): [number, number] | null => {
    const el = document.querySelector(selector);
    const r = el?.getBoundingClientRect();
    if (!el || !r || r.width === 0) return null;
    const [x, y] = [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)];
    const top = document.elementFromPoint(x, y);
    return top && el.contains(top) ? [x, y] : null;
  }, selector);

/** The theme's tooltip colour, as the shell's CSS has it. */
const tooltipColour = () =>
  browser.execute(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--desk-tooltip)";
    document.body.append(probe);
    const rgb = getComputedStyle(probe).color.match(/\d+/g)?.map(Number) ?? [];
    probe.remove();
    return rgb.slice(0, 3);
  });

/** The share of `rect`'s pixels (CSS px, inset by 3) of colour `rgb`, and how many are light. */
function inks(img: Image, [x, y, w, h]: number[], rgb: number[]) {
  let [fill, light, all] = [0, 0, 0];
  for (let py = Math.ceil((y + 3) * img.scale); py < (y + h - 3) * img.scale; py++) {
    for (let px = Math.ceil((x + 3) * img.scale); px < (x + w - 3) * img.scale; px++) {
      const o = (py * img.width + px) * 4;
      const c = [img.data[o] ?? 0, img.data[o + 1] ?? 0, img.data[o + 2] ?? 0];
      all++;
      if (c.every((v, i) => Math.abs(v - (rgb[i] ?? 0)) <= 6)) fill++;
      if (c.every((v) => v > 170)) light++;
    }
  }
  return { fill: all ? fill / all : 0, light };
}

describe("tooltips: a page's hover title is drawn by the compositor, in the theme", () => {
  let zone: [number, number];
  let field: [number, number];

  before(async () => {
    await shellReady();
    await browser.waitUntil(
      async () =>
        (await inSurface<string>(
          INPUT,
          "document.querySelector('[data-testid=ready]').textContent",
        )) === "ready",
      { timeout: 20_000, timeoutMsg: "the input plugin never mounted" },
    );
    await feed([{ type: "windowFocused", focused: true }]);
    const local = await inSurface<[number, number]>(
      INPUT,
      `(() => {
        const zone = document.querySelector('[data-testid=drop]');
        zone.title = 'Drop files here';
        const r = zone.getBoundingClientRect();
        return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)];
      })()`,
    );
    zone = await raise(INPUT, local);
    field = await raise(INPUT, [20, 20]);
  });

  it("shows a plugin page's title under the pointer once it rests, in the theme's look", async () => {
    await arrive(field);
    await browser.pause(DELAY + 200);
    expect((await tooltip()).shown).toBeNull();
    const rested = Date.now();
    await arrive(zone);
    // Not yet: the pointer has not rested.
    const early = await tooltip();
    if (Date.now() - rested < DELAY - 100) expect(early.shown).toBeNull();
    const shown = await showing("Drop files here");
    expect(Date.now() - rested).toBeGreaterThanOrEqual(DELAY);
    expect(shown.surface).toBe(INPUT);
    const [x, y, w, h] = shown.rect ?? [];
    if (x === undefined || y === undefined || w === undefined || h === undefined)
      throw new Error("no box");
    // Under the pointer's arrow, from where the pointer is.
    expect(y).toBeGreaterThan(zone[1]);
    expect(y - zone[1]).toBeLessThan(40);
    expect(Math.abs(x - zone[0])).toBeLessThan(w);
    const width = await browser.execute(() => window.innerWidth);
    const seen = inks(await screenshot(width), [x, y, w, h], await tooltipColour());
    expect(seen.fill).toBeGreaterThan(0.5);
    expect(seen.light).toBeGreaterThan(15);
  });

  it("puts it away on a press, not to come back until the pointer moves on", async () => {
    await press();
    expect((await tooltip()).shown).toBeNull();
    await browser.pause(DELAY * 2);
    expect((await tooltip()).shown).toBeNull();
    // A hand at rest moves a pixel or two: still the title of what it pressed.
    await feed([{ type: "pointerMoved", x: zone[0] + 2, y: zone[1] }]);
    await browser.pause(DELAY * 2);
    expect((await tooltip()).shown).toBeNull();
    // Off the zone, where the page has no title, and back.
    await arrive(field);
    await browser.waitUntil(async () => (await tooltip()).titles[INPUT] === undefined, {
      timeoutMsg: "the page never said its title went",
    });
    await arrive(zone);
    await showing("Drop files here");
  });

  it("puts it away on a move, and shows it again where the pointer rests next", async () => {
    await feed([{ type: "pointerMoved", x: zone[0] + 12, y: zone[1] + 2 }]);
    expect((await tooltip()).shown).toBeNull();
    const shown = await showing("Drop files here");
    expect(shown.rect?.[0]).toBeGreaterThan(zone[0] + 6);
  });

  it("shows the desk's own titles, and its page's cursor reaches the window", async () => {
    const gear = await middle('[title="Open settings"]');
    if (!gear) throw new Error("no settings button in sight");
    await arrive(gear);
    const shown = await showing("Open settings");
    expect(shown.surface).toBe("desk");
    expect((await inputState()).cursor).toContain("Pointer");
  });

  it("labels each control the desk labels itself once: its own tooltip, no title", async () => {
    const own = await browser.execute(() =>
      [...document.querySelectorAll<HTMLElement>(".rail-button, .arrange-button")]
        .filter((b) => b.checkVisibility())
        .map((b) => ({
          key: b.dataset.key ?? b.dataset.arrange ?? "",
          titled: !!b.closest("[title]"),
        })),
    );
    expect(own.some((b) => b.key === "tile")).toBe(true);
    expect(own.filter((b) => b.titled)).toEqual([]);
    for (const selector of ['[data-arrange="tile"]', '[data-key^="rail-"]']) {
      const at = await middle(selector);
      if (!at) continue;
      await arrive(at);
      await browser.waitUntil(
        () =>
          browser.execute(() =>
            [...document.querySelectorAll<HTMLElement>('[role="tooltip"]')].some(
              (t) => !t.hidden && t.textContent,
            ),
          ),
        { timeoutMsg: `${selector}: the desk's own label never showed` },
      );
      await browser.pause(DELAY + 300);
      const { shown, titles } = await tooltip();
      expect({ selector, shown, title: titles.desk }).toEqual({
        selector,
        shown: null,
        title: undefined,
      });
    }
  });

  it("shows nothing where a window is dropped by its title, until the pointer moves on", async () => {
    const win = (await deskNow()).windows.find((w) =>
      w.panes.some((p) => p.plugin === "e2e.input"),
    );
    if (!win) throw new Error("no input window");
    const grab = titleAt(rectOf(win), 60);
    const to = { x: grab.x + 60, y: grab.y + 40 };
    await drag(grab, to, { steps: 10 });
    // Longer than the glide into place and the rest: the window's own page (ADR 0201) said its
    // title bar's title meanwhile.
    await browser.pause(DELAY * 3);
    const own = `window:${win.id}`;
    const { shown, titles } = await tooltip();
    expect(titles[own]).toBeDefined();
    expect(shown).toBeNull();
    await feed([{ type: "pointerMoved", x: to.x + 12, y: to.y }]);
    const moved = await showing(titles[own] ?? "");
    expect(moved.surface).toBe(own);
  });
});
