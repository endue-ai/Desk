import { describe, expect, it } from "vitest";
import { ManualClock } from "../clock";
import type { DesktopLayout, SurfacePlacement } from "../modes/types";
import { windowsOf } from "../shell/actions";
import { Store, sampleState } from "../shell/state";
import { Ticker } from "../shell/ticker";
import { Spread, type SpreadView, spreadWindows } from "./spread";
import { IDENTITY, type Pose, type SpreadModel } from "./spread-model";

const at = (id: string, x: number, y: number, more: Partial<SurfacePlacement> = {}) => ({
  id,
  plugin: "endue.notes",
  x,
  y,
  w: 640,
  h: 420,
  pinned: false,
  ...more,
});
const desktop = (surfaces: SurfacePlacement[]): DesktopLayout => ({
  surfaces,
  eris: null,
  rail: { visible: true },
  drawer: { visible: true },
});
const TITLES: Record<string, string> = {
  a: "Calendar",
  b: "Notes",
  c: "Mail",
  d: "Terminal",
  e: "Files",
  "p.one": "Counter",
  "p.two": "Hello",
};

/** Five windows in two rows, as the spread reads them: a b c on top, d e under them. */
function setup(options: { reduced?: boolean; covered?: string[]; unloaded?: string[] } = {}) {
  const store = new Store(sampleState("en", 0));
  store.set({
    session: {
      1: desktop([at("a", 100, 100), at("b", 600, 100), at("c", 1100, 100), at("d", 100, 500)]),
    },
    focused: "b",
  });
  store.set((s) => ({
    session: { 1: desktop([...(s.session[1]?.surfaces ?? []), at("e", 600, 500)]) },
  }));
  const clock = new ManualClock();
  const ticker = new Ticker(clock);
  const drawn: Array<Map<string, Pose>> = [];
  const calls: string[] = [];
  const view: SpreadView = {
    open: () => calls.push("open"),
    chrome: () => calls.push("chrome"),
    draw: (_model: SpreadModel, poses: Map<string, Pose>) => drawn.push(new Map(poses)),
    close: () => calls.push("close"),
  };
  const spread = new Spread(
    {
      store,
      ticker,
      reduced: () => options.reduced === true,
      size: () => ({ vw: 1440, vh: 900 }),
      windows: () =>
        spreadWindows(store.get(), {
          size: { vw: 1440, vh: 900 },
          covered: (plugin) => options.covered?.includes(plugin) ?? false,
          unloaded: (id) => options.unloaded?.includes(id) ?? false,
          title: (id) => TITLES[id] ?? id,
        }),
      reveal: () => {},
      focus: (id) => store.set({ focused: id }),
      durations: () => ({ open: 400, move: 160, close: 300 }),
    },
    view,
  );
  /** Run the frame loop for `ms`, a frame every 16 ms. */
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += 16) clock.advance(16);
  };
  return { store, spread, view, drawn, calls, run, last: () => drawn.at(-1) ?? new Map() };
}

const press = (spread: Spread, key: string, shiftKey = false) => spread.key({ key, shiftKey });
/** Let the spread's closing finish: it closes after its last frame, on a later task. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the spread's keys", () => {
  it("move the selection along the rows, between them, and in order with Tab", () => {
    const { spread } = setup();
    expect(spread.open()).toBe(true);
    const selected = () => spread.model?.selected;
    // It opens on the focused window.
    expect(selected()).toBe("b");
    press(spread, "ArrowRight");
    expect(selected()).toBe("c");
    // At the end of a row the next key goes on to the next row.
    press(spread, "ArrowRight");
    expect(selected()).toBe("d");
    press(spread, "ArrowUp");
    expect(selected()).toBe("a");
    press(spread, "ArrowDown");
    expect(selected()).toBe("d");
    press(spread, "ArrowLeft");
    expect(selected()).toBe("c");
    press(spread, "Tab");
    expect(selected()).toBe("d");
    press(spread, "Tab");
    press(spread, "Tab");
    expect(selected()).toBe("a");
    press(spread, "Tab", true);
    expect(selected()).toBe("e");
    press(spread, "Home");
    expect(selected()).toBe("a");
    press(spread, "End");
    expect(selected()).toBe("e");
  });

  it("Enter focuses the selected window and the windows go back", async () => {
    const { store, spread, calls, run, last } = setup();
    spread.open();
    run(400);
    press(spread, "ArrowRight");
    expect(press(spread, "Enter")).toBe(true);
    expect(store.get().focused).toBe("b");
    run(320);
    await flush();
    expect(store.get().focused).toBe("c");
    expect(spread.isOpen).toBe(false);
    expect(calls.at(-1)).toBe("close");
    for (const pose of last().values()) expect(pose).toEqual(IDENTITY);
  });

  it("Escape cancels: the focus stays where it was", async () => {
    const { store, spread, calls, run } = setup();
    spread.open();
    press(spread, "ArrowDown");
    expect(press(spread, "Escape")).toBe(true);
    run(320);
    await flush();
    expect(store.get().focused).toBe("b");
    expect(spread.isOpen).toBe(false);
    expect(calls.at(-1)).toBe("close");
  });

  it("typing filters by title, and Enter opens what is left selected", async () => {
    const { store, spread, run, last } = setup();
    spread.open();
    run(400);
    spread.filter("NO");
    expect(spread.model?.shown().map((w) => w.id)).toEqual(["b"]);
    spread.filter("i");
    // Mail, Terminal, Files, now one row left to right; the selection moves to the first of them.
    expect(spread.model?.shown().map((w) => w.id)).toEqual(["d", "e", "c"]);
    expect(spread.model?.selected).toBe("d");
    run(200);
    expect(last().get("b")?.opacity).toBe(0);
    expect(last().get("d")?.opacity).toBe(1);
    spread.filter("zzz");
    expect(spread.model?.selected).toBeNull();
    expect(press(spread, "Enter")).toBe(false);
    expect(spread.isOpen).toBe(true);
    spread.filter("term");
    press(spread, "Enter");
    run(320);
    await flush();
    expect(store.get().focused).toBe("d");
  });
});

describe("what the spread shows", () => {
  it("puts a placeholder on covered and unloaded windows, and moves nothing on the desk", () => {
    const { store, spread } = setup({ covered: ["p.one"], unloaded: ["a"] });
    store.set({
      adopted: [
        { id: "p.one", title: "Counter", slot: 0 },
        { id: "p.two", title: "Hello", slot: 1 },
      ],
    });
    const layout = structuredClone(store.get().session);
    const before = windowsOf(store.get());
    spread.open();
    const asleep = spread.model
      ?.windows()
      .filter((w) => w.asleep)
      .map((w) => w.id);
    // p.one's only frame is covered and a's was unloaded; p.two shows, b is the shell's own view.
    expect(asleep?.sort()).toEqual(["a", "p.one"]);
    expect(store.get().session).toEqual(layout);
    expect(windowsOf(store.get())).toEqual(before);
  });

  it("fans the windows out in depth, over its opening motion", () => {
    const { spread, drawn, run, last } = setup();
    spread.open();
    // The first frame is where the windows are.
    for (const pose of (drawn[0] ?? new Map()).values()) expect(pose).toEqual(IDENTITY);
    run(400);
    const poses = [...last().values()];
    expect(poses.some((p) => p.rotateY !== 0)).toBe(true);
    expect(poses.some((p) => p.z < -100)).toBe(true);
    expect(poses.every((p) => p.scale < 1)).toBe(true);
  });

  it("lays the windows out flat, at once, when motion is reduced", () => {
    const { spread, drawn } = setup({ reduced: true });
    spread.open();
    expect(drawn).toHaveLength(1);
    const poses = [...(drawn[0] ?? new Map()).values()];
    for (const p of poses) {
      expect([p.rotateY, p.rotateX, p.z]).toEqual([0, 0, 0]);
      expect(p.scale).toBeLessThan(1);
    }
  });

  it("pans and zooms about the pointer", () => {
    const { spread } = setup({ reduced: true });
    spread.open();
    const model = spread.model;
    if (!model) throw new Error("no spread");
    spread.zoom(2, 300, 200);
    expect(model.camera.zoom).toBe(2);
    // The point under the pointer stays put: (300 - 720) * 2 + x = 300 - 720.
    expect(model.camera.x).toBe(420);
    expect(model.camera.y).toBe(250);
    spread.pan(-20, 10);
    expect(model.camera).toEqual({ x: 400, y: 260, zoom: 2 });
    spread.zoom(100, 0, 0);
    expect(model.camera.zoom).toBe(2.5);
  });
});
