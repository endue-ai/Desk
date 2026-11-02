// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const DARK = { "--desk-eris": "#e8c98a", "--desk-eris-frost": "#e9edf4" };
const LIGHT = { "--desk-eris": "#9a6b12", "--desk-eris-frost": "#4a5d7e" };
const setTokens = (set: Record<string, string>) => {
  for (const [name, value] of Object.entries(set))
    document.documentElement.style.setProperty(name, value);
};

/** A shell context with a still clock, whose settings and theme system say when they change. */
function shell() {
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
      add: (tick: (now: number) => void) => {
        tick(0);
        return () => {};
      },
    },
    reduced: () => true,
    tr: (key: string) => key,
    bridge: { audio: { levels: () => ({ user: [], eris: [] }) } },
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
    expect(painted.body.at(-1)).toMatchObject({ gold: "#9a6b12", frost: "#4a5d7e" });
    expect(painted.moon.at(-1)).toMatchObject({ frost: "#4a5d7e" });
    eris.dispose();
    const [body, moon] = [painted.body.length, painted.moon.length];
    setTokens(DARK);
    themeChanged();
    expect([painted.body.length, painted.moon.length]).toEqual([body, moon]);
  });
});
