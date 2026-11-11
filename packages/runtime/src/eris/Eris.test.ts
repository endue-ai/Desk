// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManualClock } from "../clock";
import type { ShellCtx } from "../shell/context";
import { emptyState, Store } from "../shell/state";
import type { Palette } from "./draw";

// What the canvas was last painted with: the body (paint) and Dysnomia (paintMoon).
const painted = vi.hoisted(() => ({ body: [] as Palette[], moon: [] as Palette[] }));
vi.mock("./draw", async (original) => ({
  ...(await original<typeof import("./draw")>()),
  paint: (_c: unknown, _m: unknown, _l: unknown, palette: Palette) => painted.body.push(palette),
  paintMoon: (_c: unknown, _s: unknown, palette: Palette) => painted.moon.push(palette),
}));
const { mountEris } = await import("./Eris");
const { REST_MS } = await import("./states");
const { REFUSED_LINES } = await import("./talk");
const { Ticker } = await import("../shell/ticker");

const DARK = {
  "--desk-eris": "#e8c98a",
  "--desk-eris-frost": "#e9edf4",
  "--desk-background": "#141416",
};
const LIGHT = {
  "--desk-eris": "#9a6b12",
  "--desk-eris-frost": "#4a5d7e",
  "--desk-background": "#faf9fc",
};
const setTokens = (set: Record<string, string>) => {
  for (const [name, value] of Object.entries(set))
    document.documentElement.style.setProperty(name, value);
};

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/**
 * A shell context with a still clock, whose settings and theme system say when they change; the
 * person allows the microphone when `mic` says so.
 */
function shell(mic = false) {
  const themes = new Set<() => void>();
  const settings = new Set<(keys: string[]) => void>();
  const subscribe =
    <T>(set: Set<T>) =>
    (listener: T) => {
      set.add(listener);
      return () => set.delete(listener);
    };
  const ctx = {
    store: new Store(emptyState("en")),
    ticker: {
      now: () => 0,
      wake: () => {},
      add: (tick: (now: number) => void) => {
        tick(0);
        return () => {};
      },
    },
    reduced: () => true,
    tr: (key: string) => key,
    bridge: {
      audio: { levels: () => ({ user: [], eris: [] }) },
      perm: { request: async () => mic },
    },
    runtime: {
      settings: { onChange: subscribe(settings) },
      themes: { onChange: subscribe(themes) },
    },
  } as unknown as ShellCtx;
  const themeChanged = () => {
    for (const listener of [...themes]) listener();
  };
  return { ctx, themeChanged };
}

describe("Eris's palette", () => {
  beforeEach(() => {
    painted.body.length = 0;
    painted.moon.length = 0;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as unknown as CanvasRenderingContext2D,
    );
    setTokens(DARK);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.removeAttribute("style");
    document.body.replaceChildren();
  });

  // A preview in the theme studio, a theme plugin installed or edited and the OS turning light all
  // apply a new theme without a desk.theme.* setting changing.
  it("repaints her at once when the theme in force changes, not only its settings", () => {
    const { ctx, themeChanged } = shell();
    const eris = mountEris(document.body, ctx, () => null);
    setTokens(LIGHT);
    themeChanged();
    expect(painted.body.at(-1)).toMatchObject({
      gold: "#9a6b12",
      frost: "#4a5d7e",
      ground: "#faf9fc",
    });
    expect(painted.moon.at(-1)).toMatchObject({ frost: "#4a5d7e" });
    eris.dispose();
    const [body, moon] = [painted.body.length, painted.moon.length];
    setTokens(DARK);
    themeChanged();
    expect([painted.body.length, painted.moon.length]).toEqual([body, moon]);
  });

  it("is a button: a click or Enter asks, listens once allowed; Escape ends the turn", async () => {
    const { ctx } = shell(true);
    const eris = mountEris(document.body, ctx, () => null);
    const el = document.querySelector<HTMLElement>(".eris");
    expect(el?.getAttribute("role")).toBe("button");
    el?.click();
    await settle();
    expect(ctx.store.get().eris.state).toBe("listening");
    el?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(ctx.store.get().eris.state).toBe("idle");
    el?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(ctx.store.get().eris.state).toBe("listening");
    eris.dispose();
  });

  it("does not listen without the microphone: a refusal says she can be typed to", async () => {
    const { ctx } = shell(false);
    const eris = mountEris(document.body, ctx, () => null);
    const el = document.querySelector<HTMLElement>(".eris");
    el?.click();
    expect(ctx.store.get().eris.state).not.toBe("listening");
    expect(el?.dataset.talk).not.toBe("listening");
    await settle();
    expect(ctx.store.get().eris.state).not.toBe("listening");
    expect(ctx.store.get().eris.saying).toBe(REFUSED_LINES.en);
    eris.dispose();
  });

  it("rests once idle, silent and settled for a while, and a new state wakes her", () => {
    const { ctx } = shell();
    const clock = new ManualClock();
    const live = ctx as unknown as { ticker: InstanceType<typeof Ticker>; reduced: () => boolean };
    live.ticker = new Ticker(clock);
    live.reduced = () => false;
    const eris = mountEris(document.body, ctx, () => null);
    const run = (ms: number) => {
      for (let t = 0; t < ms; t += 16) clock.advance(16);
    };
    run(1000);
    expect(painted.body.length, "her idle motion runs").toBeGreaterThan(50);
    run(REST_MS);
    const rested = painted.body.length;
    run(2000);
    expect(painted.body.length, "at rest: nothing painted").toBe(rested);
    ctx.store.set((s) => ({ eris: { ...s.eris, state: "thinking" } }));
    run(500);
    expect(painted.body.length, "woken by her new state").toBeGreaterThan(rested + 20);
    eris.dispose();
  });
});
