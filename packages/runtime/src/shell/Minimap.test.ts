// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopLayout, SurfacePlacement } from "../modes/types";
import type { ShellCtx } from "./context";
import { mountMinimap } from "./Minimap";
import { fitWorld, toMap, viewRect, worldOf } from "./minimap-model";
import { emptyState, Store } from "./state";

const win = (id: string, x: number, y: number, extra: Partial<SurfacePlacement> = {}) =>
  ({
    id,
    plugin: id,
    x,
    y,
    w: 400,
    h: 300,
    panes: { kind: "view", id: `${id}-pane`, view: `plugin:${id}` },
    ...extra,
  }) as SurfacePlacement;
const layout = (...surfaces: SurfacePlacement[]): DesktopLayout => ({
  surfaces,
  eris: null,
  rail: { visible: true },
  drawer: { visible: true },
});
const adopted = (...ids: string[]) => ids.map((id) => ({ id, title: id.toUpperCase() }));

describe("the canvas map", () => {
  let root: HTMLDivElement;
  let store: Store;
  let dispose: () => void;

  const mount = () => {
    const ctx = { store, tr: (key: string) => key } as unknown as ShellCtx;
    dispose = mountMinimap(root, ctx);
  };
  const map = () => root.querySelector<HTMLElement>(".minimap-map");
  const pan = () => store.get().pan["1"] ?? { x: 0, y: 0 };
  /** The fit the map draws with, from the same world it draws. */
  const fitNow = () => {
    const s = store.get();
    const windows = (s.session["1"]?.surfaces ?? []).filter((p) => !p.floating);
    return fitWorld(worldOf(windows, viewRect(pan(), window.innerWidth, window.innerHeight)));
  };
  const pointer = (type: string, x: number, y: number, target: Element | null = map()) => {
    target?.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        isPrimary: true,
        button: 0,
        clientX: x,
        clientY: y,
      }),
    );
  };

  beforeEach(() => {
    root = document.createElement("div");
    document.body.append(root);
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    store = new Store({
      ...emptyState("en"),
      adopted: adopted("mail", "notes", "player"),
      session: { "1": layout(win("mail", 100, 100), win("notes", 3000, 1600)) },
      focused: "notes",
    });
  });

  afterEach(() => {
    dispose();
    root.remove();
  });

  it("is not there while the canvas holds nothing to find", () => {
    store = new Store(emptyState("en"));
    mount();
    expect(root.querySelector(".minimap")).toBeNull();
    store.set({ pan: { "1": { x: -200, y: 0 } } });
    expect(root.querySelector(".minimap")).not.toBeNull();
  });

  it("draws every normal window to scale, the focused one marked, and leaves floating ones out", () => {
    store.set((s) => ({
      session: {
        "1": layout(...(s.session["1"]?.surfaces ?? []), win("player", 0, 0, { floating: true })),
      },
    }));
    mount();
    const drawn = [...root.querySelectorAll<HTMLElement>(".minimap-window")];
    expect(
      drawn.map((w) => [w.dataset.window, w.title, w.classList.contains("is-focused")]),
    ).toEqual([
      ["mail", "MAIL", false],
      ["notes", "NOTES", true],
    ]);
    const at = toMap(win("notes", 3000, 1600), fitNow());
    expect(parseFloat(drawn[1]?.style.left ?? "")).toBeCloseTo(at.x, 0);
    expect(parseFloat(drawn[1]?.style.width ?? "")).toBeCloseTo(at.w, 0);
    expect(map()?.getAttribute("aria-label")).toBe("canvasMap");
  });

  it("takes the view where it is pressed, centred on that point", () => {
    mount();
    const fit = fitNow();
    const notes = toMap(win("notes", 3000, 1600), fit);
    // jsdom lays the map out at 0, 0: press the middle of Notes on the map.
    pointer("pointerdown", notes.x + notes.w / 2, notes.y + notes.h / 2);
    pointer("pointerup", notes.x + notes.w / 2, notes.y + notes.h / 2);
    const view = viewRect(pan(), window.innerWidth, window.innerHeight);
    expect(view.x + view.w / 2).toBeCloseTo(3200, -1);
    expect(view.y + view.h / 2).toBeCloseTo(1750, -1);
  });

  it("moves the view with a drag of the part in sight, and Escape puts it back", () => {
    mount();
    const fit = fitNow();
    const frame = root.querySelector(".minimap-view");
    pointer("pointerdown", 5, 5, frame);
    pointer("pointermove", 25, 15, frame);
    expect(pan().x).toBeCloseTo(-20 / fit.scale, -1);
    expect(pan().y).toBeCloseTo(-10 / fit.scale, -1);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(pan()).toEqual({ x: 0, y: 0 });
  });

  it("moves with the arrow keys and goes back to the start with Home", () => {
    mount();
    const key = (k: string, shiftKey = false) =>
      map()?.dispatchEvent(new KeyboardEvent("keydown", { key: k, shiftKey, bubbles: true }));
    key("ArrowRight");
    expect(pan()).toEqual({ x: -Math.round(window.innerWidth / 4), y: 0 });
    key("ArrowDown", true);
    expect(pan()).toEqual({ x: -Math.round(window.innerWidth / 4), y: -window.innerHeight });
    key("Home");
    expect(pan()).toEqual({ x: 0, y: 0 });
  });

  it("folds to one button and opens again, and the session keeps which", () => {
    mount();
    const fold = () => root.querySelector<HTMLButtonElement>(".minimap-fold");
    expect(fold()?.getAttribute("aria-label")).toBe("foldMap");
    fold()?.click();
    expect(store.get().mapFolded).toBe(true);
    expect(map()?.hidden).toBe(true);
    expect(fold()?.getAttribute("aria-expanded")).toBe("false");
    expect(fold()?.getAttribute("aria-label")).toBe("showMap");
    fold()?.click();
    expect(map()?.hidden).toBe(false);
  });

  it("folds by itself while a filled window is in sight, and opens over it when asked (#3)", () => {
    mount();
    const fold = () => root.querySelector<HTMLButtonElement>(".minimap-fold");
    const fillMail = (fill: SurfacePlacement["fill"]) =>
      store.set((s) => ({
        session: {
          "1": layout(
            ...(s.session["1"]?.surfaces ?? []).map((p) => (p.id === "mail" ? { ...p, fill } : p)),
          ),
        },
      }));
    fillMail("full");
    expect(map()?.hidden).toBe(true);
    // The person's choice is still an open map: it comes back once nothing fills the view.
    expect(store.get().mapFolded).toBe(false);
    fold()?.click();
    expect(map()?.hidden).toBe(false);
    fold()?.click();
    expect(map()?.hidden).toBe(true);
    expect(store.get().mapFolded).toBe(false);
    fillMail(undefined);
    expect(map()?.hidden).toBe(false);
    // A filled window out of sight leaves the map open.
    fillMail("right");
    store.set({ pan: { "1": { x: -5000, y: 0 } } });
    expect(map()?.hidden).toBe(false);
  });
});
