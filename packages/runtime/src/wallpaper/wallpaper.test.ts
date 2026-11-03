// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { ManualClock } from "../clock";
import { CORE_SETTINGS } from "../core/defaults";
import { Settings } from "../settings";
import type { ShellCtx } from "../shell/context";
import { emptyState, Store } from "../shell/state";
import { Ticker } from "../shell/ticker";
import { mountWallpaper } from "./wallpaper";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const off of cleanups.splice(0)) off();
  document.body.replaceChildren();
});
function setup() {
  const root = document.createElement("div");
  document.body.append(root);
  const clock = new ManualClock();
  const ticker = new Ticker(clock);
  const store = new Store(emptyState("en"));
  const settings = new Settings();
  settings.setDefaults(CORE_SETTINGS);
  settings.set("desk.wallpaper.scene", "pond");
  let reduced = false;
  let changed = () => {};
  const ctx = {
    store, ticker, reduced: () => reduced,
    runtime: { settings, themes: { onChange: (fn: () => void) => { changed = fn; return () => {}; } } },
  } as unknown as ShellCtx;
  const off = mountWallpaper(root, ctx);
  cleanups.push(off, () => ticker.dispose());
  const open = (id: string) => store.set((s) => ({ adopted: [...s.adopted, { id, title: id }] }));
  return { root, clock, store, settings, open, off, reduce: () => { reduced = true; changed(); } };
}
it("follows pan on an empty desk and restores the theme without replacing it with a grid", () => {
  const { root, store, settings } = setup();
  store.set({ pan: { 1: { x: -2200, y: 1400 } } });
  const scene = root.querySelector<HTMLElement>(".wallpaper");
  expect(scene?.style.getPropertyValue("--wallpaper-x")).toBe("-2200px");
  expect(scene?.style.getPropertyValue("--wallpaper-y")).toBe("1400px");
  expect(scene?.dataset.scene).toBe("pond");
  settings.set("desk.wallpaper.scene", "theme");
  expect(scene?.dataset.scene).toBe("theme");
});
it("makes one world-space ripple for a new window, keeps it attached while panning, and bounds bursts", () => {
  const { root, store, open, clock } = setup();
  open("endue.sidebar");
  const ripple = root.querySelector<HTMLElement>(".wallpaper-ripple");
  expect(ripple).not.toBeNull();
  const x = ripple?.style.getPropertyValue("--ripple-x");
  store.set({ pan: { 1: { x: 150, y: -80 } }, focused: "endue.sidebar" });
  expect(root.querySelectorAll(".wallpaper-ripple")).toHaveLength(1);
  expect(ripple?.style.getPropertyValue("--ripple-x")).toBe(x);
  for (let n = 0; n < 30; n++) open(`plugin-${n}`);
  expect(root.querySelectorAll(".wallpaper-ripple").length).toBeLessThanOrEqual(16);
  clock.advance(4000);
  expect(root.querySelectorAll(".wallpaper-ripple")).toHaveLength(0);
});
it("clears transient effects on desktop/scene switches and suppresses motion when requested", () => {
  const { root, open, store, settings, reduce, clock } = setup();
  open("first");
  store.set({ desktop: 2 });
  expect(root.querySelectorAll(".wallpaper-ripple")).toHaveLength(0);
  open("second");
  settings.set("desk.wallpaper.scene", "aurora");
  expect(root.querySelectorAll(".wallpaper-ripple")).toHaveLength(0);
  clock.advance(1000);
  const phase = root.querySelector<HTMLElement>(".wallpaper")?.style.getPropertyValue("--wallpaper-drift");
  expect(phase).toBeTruthy();
  reduce();
  const still = root.innerHTML;
  clock.advance(1000);
  expect(root.innerHTML).toBe(still);
  settings.set("desk.wallpaper.scene", "pond");
  open("third");
  expect(root.querySelectorAll(".wallpaper-ripple")).toHaveLength(0);
});
it("removes listeners and animation updates on disposal", () => {
  const { root, off, open, clock } = setup();
  off();
  open("after-disposal");
  clock.advance(5000);
  expect(root.querySelector(".wallpaper")).toBeNull();
});
