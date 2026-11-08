// The terminal refits whenever its box or its cells may have changed (#538): the panes resized (open,
// a window resized, maximized or snapped), the page shown again (raised, another desktop, woken after
// an unload, ADR 0070), the device pixel ratio changed (the desk scaled, another display) and the
// fonts loaded; one fit per frame. The PTY then gets the new columns and rows.
import { describe, expect, it } from "vitest";
import { watchFit } from "../ui/fit.js";
import { mount, scope } from "./harness";

type Listener = () => void;

function page(dpr = 2) {
  const on = (bag: Map<string, Set<Listener>>) => ({
    addEventListener: (type: string, listener: Listener) => {
      const set = bag.get(type) ?? new Set();
      set.add(listener);
      bag.set(type, set);
    },
    removeEventListener: (type: string, listener: Listener) => bag.get(type)?.delete(listener),
  });
  const fire = (bag: Map<string, Set<Listener>>, type: string) => {
    for (const listener of [...(bag.get(type) ?? [])]) listener();
  };
  const winEvents = new Map<string, Set<Listener>>();
  const docEvents = new Map<string, Set<Listener>>();
  const fontEvents = new Map<string, Set<Listener>>();
  const queries: Array<{ query: string; events: Map<string, Set<Listener>> }> = [];
  const observers: Array<{ callback: Listener; observed: unknown[]; on: boolean }> = [];
  let frames: Listener[] = [];
  const win = {
    devicePixelRatio: dpr,
    ...on(winEvents),
    matchMedia: (query: string) => {
      const events = new Map<string, Set<Listener>>();
      queries.push({ query, events });
      return { media: query, matches: true, ...on(events) };
    },
    requestAnimationFrame: (callback: Listener) => frames.push(callback),
    cancelAnimationFrame: () => {},
    ResizeObserver: class {
      record: { callback: Listener; observed: unknown[]; on: boolean };
      constructor(callback: Listener) {
        this.record = { callback, observed: [], on: true };
        observers.push(this.record);
      }
      observe(target: unknown) {
        this.record.observed.push(target);
      }
      disconnect() {
        this.record.on = false;
      }
    },
  };
  const doc = { visibilityState: "visible", ...on(docEvents), fonts: on(fontEvents) };
  const flush = () => {
    const due = frames;
    frames = [];
    for (const frame of due) frame();
  };
  return {
    win,
    doc,
    flush,
    observers,
    queries,
    resized: () => {
      for (const o of observers) if (o.on) o.callback();
    },
    window: (type: string) => fire(winEvents, type),
    document: (type: string) => fire(docEvents, type),
    fonts: (type: string) => fire(fontEvents, type),
    scaled: (to: number) => {
      const last = queries.at(-1);
      win.devicePixelRatio = to;
      if (last) fire(last.events, "change");
    },
  };
}

function watched(dpr = 2) {
  const p = page(dpr);
  const target = { id: "panes" };
  let fits = 0;
  const stop = watchFit({
    win: p.win as unknown as Window,
    doc: p.doc as unknown as Document,
    target: target as unknown as Element,
    fit: () => {
      fits += 1;
    },
  });
  return { ...p, target, stop, fits: () => fits };
}

describe("when the terminal refits", () => {
  it("on a resize of its panes, once per frame however many arrive", () => {
    const w = watched();
    expect(w.observers[0]?.observed).toEqual([w.target]);
    w.resized();
    w.resized();
    w.window("resize");
    expect(w.fits()).toBe(0);
    w.flush();
    expect(w.fits()).toBe(1);
  });

  it("on waking: the page shown again, or brought back from the cache", () => {
    const w = watched();
    w.doc.visibilityState = "hidden";
    w.document("visibilitychange");
    w.flush();
    expect(w.fits()).toBe(0);
    w.doc.visibilityState = "visible";
    w.document("visibilitychange");
    w.flush();
    w.window("pageshow");
    w.flush();
    w.window("focus");
    w.flush();
    expect(w.fits()).toBe(3);
  });

  it("on a scale change, on another display and when the fonts load", () => {
    const w = watched(2);
    expect(w.queries.map((q) => q.query)).toEqual(["(resolution: 2dppx)"]);
    w.scaled(1.5);
    w.flush();
    expect(w.fits()).toBe(1);
    // Watching the ratio it moved to, so the next change is heard as well.
    expect(w.queries.map((q) => q.query)).toEqual(["(resolution: 2dppx)", "(resolution: 1.5dppx)"]);
    w.scaled(1);
    w.flush();
    w.fonts("loadingdone");
    w.flush();
    expect(w.fits()).toBe(3);
  });

  it("stops listening when it is stopped", () => {
    const w = watched();
    w.stop();
    w.resized();
    w.window("resize");
    w.document("visibilitychange");
    w.scaled(3);
    w.fonts("loadingdone");
    w.flush();
    expect(w.fits()).toBe(0);
    expect(w.observers[0]?.on).toBe(false);
  });
});

describe("the PTY's size", () => {
  it("follows the fit: the new columns and rows reach proc.resize", async () => {
    const { app, params, settle } = await mount({ size: { cols: 100, rows: 30 } });
    app.resize("t-1", 132, 43);
    app.resize("t-1", 132, 43);
    app.resize("t-1", 61, 17);
    await settle();
    expect(params("proc.resize")).toEqual([
      { procId: "p1", size: { cols: 132, rows: 43 }, scope: scope("zsh") },
      { procId: "p1", size: { cols: 61, rows: 17 }, scope: scope("zsh") },
    ]);
  });

  it("after a wake the terminal comes back at the size it is drawn now", async () => {
    const first = await mount({ size: { cols: 100, rows: 30 } });
    const woken = await mount({ state: first.host.state, size: { cols: 177, rows: 51 } });
    expect(woken.params("proc.resize")).toEqual([
      { procId: "p1", size: { cols: 177, rows: 51 }, scope: scope("zsh") },
    ]);
  });
});
