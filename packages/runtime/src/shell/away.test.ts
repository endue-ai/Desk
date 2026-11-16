// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bandOf, filled, LEAVE_MS, mountAway } from "./away";
import type { ShellCtx } from "./context";
import { type DeskState, Store, sampleState } from "./state";

const HTML = `
  <div class="layer" data-layer="system">
    <nav class="modes"></nav>
    <nav class="desktops"></nav>
    <aside class="sidebar"><button class="agent"></button></aside>
    <nav class="account-bar"></nav>
  </div>
  <div class="eris"></div>
  <aside class="rail"><button class="rail-button"></button></aside>
  <footer class="bottom">
    <div class="composer"></div>
    <ul class="running"></ul>
  </footer>
  <div class="map-strip"><div class="drawer"></div><button class="canvas-reset"></button></div>
  <div class="surfaces"><section class="surface"></section></div>`;

/** Where each part rests in a 1024×768 app (jsdom lays nothing out). */
const BOXES: Record<string, [x: number, y: number, w: number, h: number]> = {
  modes: [24, 24, 100, 80],
  desktops: [760, 20, 240, 40],
  sidebar: [24, 200, 56, 220],
  eris: [448, 40, 128, 138],
  rail: [944, 223, 56, 322],
  composer: [420, 700, 184, 48],
  running: [560, 708, 120, 32],
  "map-strip": [798, 704, 202, 32],
};

const full = { id: "notes", plugin: "endue.shell", x: 0, y: 0, w: 1024, h: 768, pinned: false };

describe("the desk's chrome while a window fills the app (ADR 0221)", () => {
  let root: HTMLDivElement;
  let store: Store;
  let dispose: () => void;

  const part = (name: string) => root.querySelector<HTMLElement>(`.${name}`) as HTMLElement;
  const out = () =>
    Object.keys(BOXES)
      .filter((name) => part(name).classList.contains("is-out"))
      .sort();
  const all = Object.keys(BOXES).sort();
  const windows = (fill?: "full" | "left") =>
    store.set((s) => ({
      wm: { ...s.wm, windows: { "1": [{ ...full, ...(fill ? { fill } : {}) }] } },
    }));
  const move = (target: Element, clientX: number, clientY: number) =>
    target.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX, clientY }));
  const surface = () => root.querySelector(".surface") as Element;

  beforeEach(() => {
    vi.useFakeTimers();
    root = document.createElement("div");
    root.className = "shell";
    root.innerHTML = HTML;
    document.body.append(root);
    for (const [name, [x, y, w, h]] of Object.entries(BOXES)) {
      part(name).getBoundingClientRect = () => new DOMRect(x, y, w, h);
    }
    store = new Store(sampleState("en", 0));
    dispose = mountAway(root, { store } as unknown as ShellCtx);
  });

  afterEach(() => {
    dispose();
    root.remove();
    vi.useRealTimers();
  });

  it("names the edges a point is within ten pixels of", () => {
    expect(bandOf(500, 400, 1024, 768)).toEqual([]);
    expect(bandOf(9, 400, 1024, 768)).toEqual(["left"]);
    expect(bandOf(10, 400, 1024, 768)).toEqual([]);
    expect(bandOf(1014, 400, 1024, 768)).toEqual(["right"]);
    expect(bandOf(1013, 400, 1024, 768)).toEqual([]);
    expect(bandOf(1020, 3, 1024, 768)).toEqual(["right", "top"]);
    expect(bandOf(500, 767, 1024, 768)).toEqual(["bottom"]);
  });

  it("leaves everything in place while no window fills the whole app", () => {
    expect(filled(store.get())).toBe(false);
    windows("left");
    expect(out()).toEqual([]);
    expect(root.classList.contains("is-away")).toBe(false);
  });

  it("sends each part out past its own edge, and leaves only the account bar", () => {
    windows("full");
    expect(root.classList.contains("is-away")).toBe(true);
    expect(out()).toEqual(all);
    const edges = Object.fromEntries(all.map((name) => [name, part(name).dataset.away]));
    expect(edges).toEqual({
      composer: "bottom",
      desktops: "top",
      eris: "top",
      "map-strip": "right",
      modes: "top",
      rail: "right",
      running: "bottom",
      sidebar: "left",
    });
    // How far: its whole box and 16 px more.
    expect(part("sidebar").style.getPropertyValue("--away-x")).toBe("-96px");
    expect(part("rail").style.getPropertyValue("--away-x")).toBe("96px");
    expect(part("modes").style.getPropertyValue("--away-y")).toBe("-120px");
    expect(part("composer").style.getPropertyValue("--away-y")).toBe("84px");
    // The strip under the map goes with the rail, its own box and 16 more past the right edge.
    expect(part("map-strip").style.getPropertyValue("--away-x")).toBe("242px");
    const bar = root.querySelector(".account-bar") as HTMLElement;
    expect([bar.classList.contains("is-out"), bar.dataset.away]).toEqual([false, undefined]);
    // Nothing else stays: the Drawer and the origin buttons go with the strip that holds them.
    for (const el of root.querySelectorAll(".drawer, .canvas-reset")) {
      expect(el.closest(".is-out")).not.toBeNull();
    }
    // The Drawer's panel open keeps the right edge's parts in sight.
    store.set({ popover: "drawer" });
    expect(out()).toEqual(all.filter((name) => name !== "map-strip" && name !== "rail"));
    store.set({ popover: null });
    vi.advanceTimersByTime(LEAVE_MS);
    expect(out()).toEqual(all);
  });

  it("brings an edge's parts back while the compositor says the pointer is there, and sends them away after it has gone", () => {
    windows("full");
    store.set({ edges: ["left"] });
    expect(out()).toEqual(all.filter((name) => name !== "sidebar"));
    store.set({ edges: [] });
    vi.advanceTimersByTime(LEAVE_MS - 1);
    expect(part("sidebar").classList.contains("is-out")).toBe(false);
    vi.advanceTimersByTime(1);
    expect(out()).toEqual(all);
    // A corner is two edges.
    store.set({ edges: ["right", "top"] });
    expect(out()).toEqual(["composer", "running", "sidebar"]);
  });

  it("keeps a part in sight while the pointer is on it, from the edge and after", () => {
    windows("full");
    move(surface(), 1020, 400);
    expect(part("rail").classList.contains("is-out")).toBe(false);
    // Across the gap between the edge and the rail, in less than the leave time.
    move(surface(), 1005, 400);
    vi.advanceTimersByTime(LEAVE_MS - 100);
    move(part("rail").querySelector(".rail-button") as Element, 970, 400);
    vi.advanceTimersByTime(5000);
    expect(part("rail").classList.contains("is-out")).toBe(false);
    move(surface(), 600, 400);
    vi.advanceTimersByTime(LEAVE_MS);
    expect(out()).toEqual(all);
  });

  it("sends a part away once the pointer has left the page from it", () => {
    windows("full");
    store.set({ edges: ["left"] });
    move(part("sidebar").querySelector(".agent") as Element, 50, 300);
    store.set({ edges: [] });
    vi.advanceTimersByTime(5000);
    expect(part("sidebar").classList.contains("is-out")).toBe(false);
    // In the app the pointer goes on to a window's page: this page hears only that it left.
    document.documentElement.dispatchEvent(new Event("pointerleave"));
    vi.advanceTimersByTime(LEAVE_MS);
    expect(out()).toEqual(all);
  });

  it("keeps what is open or at work in sight: a popover of the rail, the talk line, Eris", () => {
    windows("full");
    store.set({ edges: ["right"] });
    store.set({ popover: "arrange", edges: [] });
    vi.advanceTimersByTime(5000);
    expect(part("rail").classList.contains("is-out")).toBe(false);
    store.set({ popover: null });
    vi.advanceTimersByTime(LEAVE_MS);
    expect(part("rail").classList.contains("is-out")).toBe(true);

    store.set((s) => ({ composer: { ...s.composer, open: true } }));
    expect(out()).toEqual(["desktops", "eris", "map-strip", "modes", "rail", "sidebar"]);
    store.set((s) => ({ composer: { ...s.composer, open: false } }));
    vi.advanceTimersByTime(LEAVE_MS);

    store.set((s) => ({ eris: { ...s.eris, state: "thinking" } as DeskState["eris"] }));
    expect(part("eris").classList.contains("is-out")).toBe(false);
    store.set((s) => ({ eris: { ...s.eris, state: "idle" } }));
    vi.advanceTimersByTime(LEAVE_MS);
    expect(out()).toEqual(all);
  });

  it("goes with whichever of the top and the bottom Eris and the talk pill are nearer", () => {
    part("eris").getBoundingClientRect = () => new DOMRect(448, 560, 128, 138);
    part("composer").getBoundingClientRect = () => new DOMRect(420, 100, 184, 48);
    windows("full");
    expect([part("eris").dataset.away, part("composer").dataset.away]).toEqual(["bottom", "top"]);
    expect(part("eris").style.getPropertyValue("--away-y")).toBe("224px");
    expect(part("composer").style.getPropertyValue("--away-y")).toBe("-164px");
  });

  it("brings everything back at once when the window no longer fills the app", () => {
    windows("full");
    store.set({ edges: ["left"] });
    store.set({ edges: [] });
    windows();
    expect(out()).toEqual([]);
    expect(root.classList.contains("is-away")).toBe(false);
    // The leave that was pending does nothing later.
    vi.advanceTimersByTime(LEAVE_MS * 2);
    expect(out()).toEqual([]);
  });
});
