// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { ManualClock } from "../clock";
import { CORE_SETTINGS } from "../core/defaults";
import { Settings } from "../settings";
import type { ShellCtx } from "../shell/context";
import { emptyState, Store } from "../shell/state";
import { Ticker } from "../shell/ticker";
import { testWindowManager } from "../wm/testing";
import type { Edit } from "../wm/types";
import { takeDesk } from "../wm/view";
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
  const wm = testWindowManager();
  wm.connect((published) => takeDesk(store, published));
  const settings = new Settings();
  settings.setDefaults(CORE_SETTINGS);
  settings.set("desk.wallpaper.scene", "pond");
  let reduced = false;
  let changed = () => {};
  const ctx = {
    store,
    ticker,
    reduced: () => reduced,
    runtime: {
      settings,
      themes: {
        onChange: (fn: () => void) => {
          changed = fn;
          return () => {};
        },
      },
    },
  } as unknown as ShellCtx;
  const off = mountWallpaper(root, ctx);
  cleanups.push(off, () => ticker.dispose());
  // A plugin surface handed over opens its window in a slot; desk-wm publishes it at once.
  const open = (id: string) => void wm.edit([{ op: "adopt", id, title: id }]);
  const edit = (...edits: Edit[]) => void wm.edit(edits);
  return {
    root,
    clock,
    store,
    settings,
    open,
    edit,
    off,
    reduce: () => {
      reduced = true;
      changed();
    },
  };
}
it("follows pan on an empty desk and restores the theme without replacing it with a grid", () => {
  const { root, edit, settings } = setup();
  edit({ op: "pan", to: { x: -2200, y: 1400 } });
  const scene = root.querySelector<HTMLElement>(".wallpaper");
  expect(scene?.style.getPropertyValue("--wallpaper-x")).toBe("-2200px");
  expect(scene?.style.getPropertyValue("--wallpaper-y")).toBe("1400px");
  expect(scene?.dataset.scene).toBe("pond");
  settings.set("desk.wallpaper.scene", "theme");
  expect(scene?.dataset.scene).toBe("theme");
});
it("makes one world-space ripple for a new window, keeps it attached while panning, and bounds bursts", () => {
  const { root, edit, open, clock } = setup();
  open("endue.sidebar");
  const ripple = root.querySelector<HTMLElement>(".wallpaper-ripple");
  expect(ripple).not.toBeNull();
  const x = ripple?.style.getPropertyValue("--ripple-x");
  edit({ op: "pan", to: { x: 150, y: -80 } }, { op: "focus", window: "endue.sidebar" });
  expect(root.querySelectorAll(".wallpaper-ripple")).toHaveLength(1);
  expect(ripple?.style.getPropertyValue("--ripple-x")).toBe(x);
  for (let n = 0; n < 30; n++) open(`plugin-${n}`);
  expect(root.querySelectorAll(".wallpaper-ripple").length).toBeLessThanOrEqual(16);
  clock.advance(4000);
  expect(root.querySelectorAll(".wallpaper-ripple")).toHaveLength(0);
});
it("clears transient effects on desktop/scene switches and suppresses motion when requested", () => {
  const { root, open, edit, settings, reduce, clock } = setup();
  open("first");
  expect(root.querySelectorAll(".wallpaper-ripple")).toHaveLength(1);
  edit({ op: "set-desktop", desktop: 2 });
  expect(root.querySelectorAll(".wallpaper-ripple")).toHaveLength(0);
  open("second");
  settings.set("desk.wallpaper.scene", "aurora");
  expect(root.querySelectorAll(".wallpaper-ripple")).toHaveLength(0);
  clock.advance(1000);
  const phase = root
    .querySelector<HTMLElement>(".wallpaper")
    ?.style.getPropertyValue("--wallpaper-drift");
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
it("stops unseen live updates and resumes when the document is visible", () => {
  const { root, open, clock } = setup();
  const original = Object.getOwnPropertyDescriptor(document, "hidden");
  try {
    open("before-hide");
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(root.querySelectorAll(".wallpaper-ripple")).toHaveLength(0);
    const still = root.innerHTML;
    clock.advance(5000);
    expect(root.innerHTML).toBe(still);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
    clock.advance(1000);
    expect(root.innerHTML).not.toBe(still);
  } finally {
    if (original) Object.defineProperty(document, "hidden", original);
    else Reflect.deleteProperty(document, "hidden");
  }
});
