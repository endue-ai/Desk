// @vitest-environment jsdom
// The page's report (#81, ADR 0151, ADR 0160): each plugin surface's document, load count and state
// with what its window says without a live page, read from the runtime's surface pages (never a
// frame in this page), the places of its own system layer's plugin surfaces and its parts, and the
// titles of the shell's own views; desk-wm holds the desk itself (#83), and the live set it sends
// back is the seam's (compositor-wm.test.ts). A surface moved in the page is the same surface; one
// released is not named.
import { iconPath, type RemoteSurface } from "@endue-ai/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cardOf, type DeskReport, startCompositorDesk } from "./compositor-desk";

const HOST = "main.endue-notes";
const NOTES = `desk-plugin://${HOST}/endue.notes/ui/index.html?v=1`;

/** The runtime's parts the reporter reads, played by the test. */
function runtime(adopted: string[]) {
  const asleep = new Set<string>();
  const states = new Map<string, "late" | "stopped">();
  // What desk-wm published last: one launcher window on the desktop in front.
  const launcher = { id: "window-1", panes: { id: "p1", kind: "view", view: "launcher" } };
  let state = {
    lang: "en",
    adopted: adopted.map((id, slot) => ({ id, title: id, slot })),
    drawer: [],
    wm: { here: "1", windows: { "1": [launcher] } },
    erisWindows: [] as { id: string; glow: number }[],
  };
  // The store's watch, as far as the reporter uses it: told of every change.
  const watching = new Set<() => void>();
  const desk = {
    store: {
      get: () => state,
      set: (s: Partial<typeof state>) => {
        state = { ...state, ...s };
        for (const told of watching) told();
      },
      watch: (_select: unknown, told: () => void) => {
        watching.add(told);
        return () => watching.delete(told);
      },
    },
    runtime: {
      frames: { state: (id: string) => states.get(id), asleep: (id: string) => asleep.has(id) },
      settings: { get: (key: string, fallback: unknown) => (key.endsWith("live") ? 4 : fallback) },
    },
  };
  const release = () => desk.store.set({ adopted: [] });
  /** Eris turns to these windows, or away from them all (`eris/visiting.ts`). */
  const lit = (erisWindows: typeof state.erisWindows) => desk.store.set({ erisWindows });
  return { desk: desk as never, asleep, states, release, lit, watching };
}

/** The runtime's surface pages, played by the test: each surface's place in its section. */
function pages() {
  const surfaces: RemoteSurface[] = [];
  return {
    list: () => surfaces,
    /** A plugin's section with its place, in a shell window unless it is the page's own. */
    add(id: string, src = NOTES, windowed = true, className = "desk-surface"): RemoteSurface {
      const section = document.createElement("section");
      section.className = className;
      section.dataset.surface = id;
      const view = document.createElement("div");
      view.className = "desk-surface-frame";
      section.append(view);
      const window_ = document.createElement("section");
      window_.className = "surface";
      window_.append(section);
      document.body.append(windowed ? window_ : section);
      const host = /^desk-plugin:\/\/([^/]+)/.exec(src)?.[1] ?? "";
      const surface = { id, host, src, loads: 1, view, away: false };
      surfaces.push(surface);
      return surface;
    },
  };
}

function frames() {
  const callbacks: FrameRequestCallback[] = [];
  const win = window as Window & typeof globalThis;
  win.requestAnimationFrame = (cb) => callbacks.push(cb);
  win.cancelAnimationFrame = () => {};
  return { win, tick: () => callbacks.shift()?.(0), pending: () => callbacks.length };
}

describe("the desk the page publishes", () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.documentElement.classList.remove("desk-compositor");
  });

  it("sends the runtime's desk and its surfaces once, again only when they change", () => {
    const { win, tick } = frames();
    const r = runtime(["endue.notes"]);
    const p = pages();
    const notes = p.add("endue.notes");
    const reports: DeskReport[] = [];
    const stop = startCompositorDesk(win, r.desk, p, (report) => reports.push(report));
    expect(document.documentElement.classList.contains("desk-compositor")).toBe(true);
    tick();
    tick();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      seq: 1,
      titles: { launcher: "New surface" },
      frames: [{ plugin: "endue.notes", host: HOST, src: NOTES, loads: 1, state: "live" }],
      budget: { live: 4, afterMs: 300_000 },
    });
    expect(document.querySelector("iframe"), "no frame stands in for it").toBeNull();
    // Its page loaded again (a new revision): the same surface, one load more.
    notes.loads = 2;
    tick();
    expect(reports[1]?.frames[0]).toMatchObject({ host: HOST, loads: 2 });
    // Put to sleep: its place is away, its placeholder says what it is.
    r.asleep.add("endue.notes");
    const section = notes.view.parentElement as HTMLElement;
    notes.view.remove();
    notes.away = true;
    const stand = document.createElement("div");
    stand.className = "desk-surface-placeholder";
    stand.innerHTML = "<p>Notes</p><p>Unloaded while out of sight.</p>";
    section.append(stand);
    tick();
    expect(reports[2]?.frames[0]).toMatchObject({
      state: "asleep",
      src: NOTES,
      card: { title: "Notes", line: "Unloaded while out of sight.", actions: [] },
    });
    // Released by the runtime, its section closed with its page: no longer named.
    r.release();
    p.list().splice(0);
    tick();
    expect(reports[3]?.frames).toEqual([]);
    stop();
    expect(document.documentElement.classList.contains("desk-compositor")).toBe(false);
  });

  it("names each view's icon and the width the person gave the map (ADR 0273)", () => {
    const { win, tick } = frames();
    const r = runtime(["endue.terminal"]);
    const store = (r.desk as { store: { set(s: object): void; get(): { wm: object } } }).store;
    const terminal = { id: "endue.terminal", plugin: "endue.terminal", panes: null };
    const launcher = { id: "window-1", panes: { id: "p1", kind: "view", view: "launcher" } };
    const windows = { "1": [terminal, launcher] };
    store.set({ mapFolded: false, mapWidth: null, wm: { here: "1", windows } });
    const reports: DeskReport[] = [];
    const stop = startCompositorDesk(win, r.desk, pages(), (report) => reports.push(report));
    tick();
    expect(reports[0]?.icons).toEqual({
      "plugin:endue.terminal": iconPath("terminal"),
      launcher: iconPath("plus"),
    });
    expect(reports[0]?.map).toEqual({ folded: false });
    store.set({ mapWidth: 288 });
    tick();
    expect(reports[1]?.map).toEqual({ folded: false, width: 288 });
    stop();
  });

  it("stops looking every frame once the desk is still, and a change or the compositor's word starts it again", async () => {
    const { win, tick, pending } = frames();
    const r = runtime(["endue.notes"]);
    const p = pages();
    const notes = p.add("endue.notes");
    const reports: DeskReport[] = [];
    const desk = startCompositorDesk(win, r.desk, p, (report) => reports.push(report));
    for (let i = 0; i < 40; i++) tick();
    expect(reports).toHaveLength(1);
    expect(pending(), "no frame asked for while nothing changes").toBe(0);
    document.body.append(document.createElement("aside"));
    await Promise.resolve();
    expect(pending(), "a change to the page: looking again").toBe(1);
    for (let i = 0; i < 40; i++) tick();
    expect(pending()).toBe(0);
    notes.loads = 2;
    desk.wake();
    tick();
    expect(reports.at(-1)?.frames[0]).toMatchObject({ loads: 2 });
    desk();
  });

  it("names the windows Eris is at with how brightly each glows, and looks again as that changes", () => {
    const { win, tick, pending } = frames();
    const r = runtime([]);
    const reports: DeskReport[] = [];
    const stop = startCompositorDesk(win, r.desk, pages(), (report) => reports.push(report));
    for (let i = 0; i < 40; i++) tick();
    expect(reports[0]?.lit).toEqual([]);
    expect(pending(), "the desk is still").toBe(0);
    // A glow changes nothing in the page: the store's word starts the look.
    r.lit([
      { id: "endue.mail", glow: 0.6 },
      { id: "window-1", glow: 1 },
    ]);
    expect(pending()).toBe(1);
    tick();
    expect(reports.at(-1)?.lit).toEqual([
      { window: "endue.mail", level: 0.6 },
      { window: "window-1", level: 1 },
    ]);
    r.lit([]);
    tick();
    expect(reports.at(-1)?.lit).toEqual([]);
    stop();
    expect(r.watching.size, "stopped, it no longer listens").toBe(0);
  });

  it("places a surface of its own system layer where the page lays it out, in its layer", () => {
    const { win, tick } = frames();
    const r = runtime([]);
    const p = pages();
    const first = "desk-plugin://main.endue-onboarding/endue.onboarding/ui/index.html?v=1";
    const overlay = p.add("endue.onboarding", first, false, "desk-surface desk-surface--overlay");
    const dock = "desk-plugin://main.endue-dock/endue.dock/ui/index.html?v=1";
    p.add("endue.dock", dock, false, "desk-surface desk-surface--edge");
    const reports: DeskReport[] = [];
    const stop = startCompositorDesk(win, r.desk, p, (report) => reports.push(report));
    tick();
    expect(reports[0]?.frames).toMatchObject([
      {
        plugin: "endue.onboarding",
        host: "main.endue-onboarding",
        place: { shown: true, layer: "overlay" },
      },
      { plugin: "endue.dock", host: "main.endue-dock", place: { shown: true, layer: "edge" } },
    ]);
    (overlay.view.parentElement as HTMLElement).hidden = true;
    tick();
    expect(reports[1]?.frames[0]?.place?.shown).toBe(false);
    stop();
  });

  it("stacks its overlays as it raises them: one shown later is drawn above", () => {
    const { win, tick } = frames();
    const r = runtime([]);
    const p = pages();
    const overlay = (id: string) =>
      p.add(id, `desk-plugin://main.${id.replace(".", "-")}/`, false, "desk-surface--overlay");
    const [palette, question] = [overlay("desk.palette"), overlay("endue.permissions")];
    (question.view.parentElement as HTMLElement).style.zIndex = "11";
    (palette.view.parentElement as HTMLElement).style.zIndex = "12";
    const reports: DeskReport[] = [];
    const stop = startCompositorDesk(win, r.desk, p, (report) => reports.push(report));
    tick();
    const zs = reports[0]?.frames.map((f) => [f.plugin, f.place?.z]);
    expect(zs).toEqual([
      ["desk.palette", 12],
      ["endue.permissions", 11],
    ]);
    stop();
  });

  it("reads Not responding with its actions, and nothing for a live frame", () => {
    const section = pages().add("e2e.hello").view.parentElement as HTMLElement;
    expect(cardOf(section, "live")).toBeUndefined();
    const asking = document.createElement("div");
    asking.className = "desk-not-responding";
    asking.innerHTML = "<p>Not responding</p><p>Hello has not answered.</p>";
    for (const label of ["Wait", "Stop"]) {
      const button = document.createElement("button");
      button.textContent = label;
      asking.append(button);
    }
    section.append(asking);
    expect(cardOf(section, "late")).toEqual({
      title: "Not responding",
      line: "Hello has not answered.",
      actions: ["Wait", "Stop"],
    });
  });
});

describe("the canvas map while a window fills the app (ADR 0221)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
    document.documentElement.classList.remove("desk-compositor");
  });

  it("goes with the strip under it: how far the strip has slid, and away once it is out", () => {
    const { win, tick } = frames();
    const r = runtime([]);
    const reports: DeskReport[] = [];
    const rail = document.createElement("aside");
    rail.className = "rail";
    const strip = document.createElement("div");
    strip.className = "map-strip";
    document.body.append(rail, strip);
    // Each slides by its own box: the map's strip further than the rail.
    let styles = new Map<Element, { translate: string; visibility: string }>();
    const rest = { translate: "none", visibility: "visible" };
    vi.spyOn(win, "getComputedStyle").mockImplementation(
      (el) => (styles.get(el) ?? rest) as CSSStyleDeclaration,
    );
    const stop = startCompositorDesk(win, r.desk, pages(), (report) => reports.push(report));
    tick();
    // A strip that goes nowhere: the map is the session's alone.
    const gone = () => {
      const { shift, away } = reports.at(-1)?.map ?? {};
      return [shift, away];
    };
    expect(gone()).toEqual([undefined, undefined]);
    for (const el of [rail, strip]) {
      el.dataset.away = "right";
      el.classList.add("is-out");
    }
    styles = new Map([
      [rail, { translate: "37.6px", visibility: "visible" }],
      [strip, { translate: "120.4px", visibility: "visible" }],
    ]);
    tick();
    expect(gone()).toEqual([120, undefined]);
    styles = new Map([
      [rail, { translate: "96px", visibility: "hidden" }],
      [strip, { translate: "242px", visibility: "hidden" }],
    ]);
    tick();
    expect(gone()).toEqual([242, true]);
    // Back in sight and at rest.
    for (const el of [rail, strip]) el.classList.remove("is-out");
    styles = new Map();
    tick();
    expect(gone()).toEqual([undefined, undefined]);
    stop();
  });

  it("goes with the right rail where the page has no strip of its own", () => {
    const { win, tick } = frames();
    const r = runtime([]);
    const reports: DeskReport[] = [];
    const rail = document.createElement("aside");
    rail.className = "rail";
    rail.dataset.away = "right";
    rail.classList.add("is-out");
    // A plugin holds the dock's role: the shell's strip is there, yielded, and not drawn.
    const strip = document.createElement("div");
    strip.className = "map-strip";
    strip.toggleAttribute("data-role-yielded", true);
    document.body.append(rail, strip);
    vi.spyOn(win, "getComputedStyle").mockImplementation(
      () => ({ translate: "96px", visibility: "hidden" }) as CSSStyleDeclaration,
    );
    const stop = startCompositorDesk(win, r.desk, pages(), (report) => reports.push(report));
    tick();
    const { shift, away } = reports.at(-1)?.map ?? {};
    expect([shift, away]).toEqual([96, true]);
    stop();
  });
});
