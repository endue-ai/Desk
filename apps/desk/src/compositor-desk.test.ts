// @vitest-environment jsdom
// Compositor mode (#81, ADR 0151): the shell page publishes the desk the runtime keeps, each plugin
// frame's document and state with what its window says without a live frame, and hears back the
// windows that keep one. A frame moved in the page is the same surface; one released is not named.
import { afterEach, describe, expect, it } from "vitest";
import {
  cardOf,
  type DeskReport,
  keptWindows,
  startCompositorDesk,
  surfaceHostOf,
} from "./compositor-desk";

const NOTES = "desk-plugin://main.endue-notes/endue.notes/ui/index.html?v=1";

/** The runtime's parts the reporter reads, played by the test. */
function runtime(adopted: string[]) {
  const asleep = new Set<string>();
  const states = new Map<string, "late" | "stopped">();
  const base = {
    manifest: { id: "base", extends: null },
    desktop: {},
    list: [{ id: "1", name: "1" }],
    desktops: {},
  };
  let state = {
    lang: "en",
    modes: [base],
    modeId: "base",
    desktop: "1",
    session: {},
    desktops: null,
    pan: {},
    focusBy: {},
    adopted: adopted.map((id, slot) => ({ id, title: id, slot })),
    drawer: [],
    focused: null,
    pane: null,
  };
  const desk = {
    store: { get: () => state, set: (s: Partial<typeof state>) => (state = { ...state, ...s }) },
    runtime: {
      frames: { state: (id: string) => states.get(id), asleep: (id: string) => asleep.has(id) },
      settings: { get: (key: string, fallback: unknown) => (key.endsWith("live") ? 4 : fallback) },
    },
  };
  return { desk: desk as never, asleep, states, release: () => desk.store.set({ adopted: [] }) };
}

/** A plugin's section with its frame, in a shell window unless it is the page's own (`windowed`). */
function frame(plugin: string, src = NOTES, windowed = true): HTMLElement {
  const section = document.createElement("section");
  section.className = "desk-surface";
  section.dataset.surface = plugin;
  const iframe = document.createElement("iframe");
  iframe.src = src;
  section.append(iframe);
  const window_ = document.createElement("section");
  window_.className = "surface";
  window_.append(section);
  document.body.append(windowed ? window_ : section);
  return section;
}

describe("the desk the page publishes", () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.documentElement.classList.remove("desk-compositor");
  });

  it("knows a plugin surface's own host and nothing else", () => {
    expect(surfaceHostOf(NOTES)).toBe("main.endue-notes");
    expect(surfaceHostOf("desk-plugin://localhost/_desk/palette/index.html")).toBeUndefined();
    expect(surfaceHostOf("about:blank")).toBeUndefined();
  });

  it("sends the runtime's desk and its frames once, again only when they change", () => {
    const callbacks: FrameRequestCallback[] = [];
    const win = window as Window & typeof globalThis;
    win.requestAnimationFrame = (cb) => callbacks.push(cb);
    win.cancelAnimationFrame = () => {};
    const r = runtime(["endue.notes"]);
    const section = frame("endue.notes");
    const reports: DeskReport[] = [];
    const stop = startCompositorDesk(win, r.desk, (report) => reports.push(report));
    const tick = () => callbacks.shift()?.(0);
    expect(document.documentElement.classList.contains("desk-compositor")).toBe(true);
    tick();
    tick();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      seq: 1,
      desk: { desktop: "1", adopted: [{ id: "endue.notes" }], session: {} },
      frames: [{ plugin: "endue.notes", host: "main.endue-notes", src: NOTES, state: "live" }],
      budget: { live: 4, afterMs: 300_000 },
    });
    // The frame moved in the page and loaded there: the same surface, one load more.
    section.querySelector("iframe")?.dispatchEvent(new Event("load"));
    tick();
    expect(reports[1]?.frames[0]).toMatchObject({ host: "main.endue-notes", loads: 1 });
    // Put to sleep: its frame is away, its placeholder says what it is.
    r.asleep.add("endue.notes");
    section.querySelector("iframe")?.remove();
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
    // Released by the runtime: no longer named.
    r.release();
    tick();
    expect(reports[3]?.frames).toEqual([]);
    stop();
    expect(document.documentElement.classList.contains("desk-compositor")).toBe(false);
  });

  it("places a surface of the page's own system layer where the page lays it out", () => {
    const callbacks: FrameRequestCallback[] = [];
    const win = window as Window & typeof globalThis;
    win.requestAnimationFrame = (cb) => callbacks.push(cb);
    win.cancelAnimationFrame = () => {};
    const r = runtime([]);
    const overlay = "desk-plugin://main.endue-onboarding/endue.onboarding/ui/index.html?v=1";
    const section = frame("endue.onboarding", overlay, false);
    const reports: DeskReport[] = [];
    const stop = startCompositorDesk(win, r.desk, (report) => reports.push(report));
    callbacks.shift()?.(0);
    expect(reports[0]?.frames).toMatchObject([
      { plugin: "endue.onboarding", host: "main.endue-onboarding", place: { shown: true } },
    ]);
    section.hidden = true;
    callbacks.shift()?.(0);
    expect(reports[1]?.frames[0]?.place?.shown).toBe(false);
    stop();
  });

  it("reads Not responding with its actions, and nothing for a live frame", () => {
    const section = frame("e2e.hello");
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

  it("keeps the live set the shell sends and tells the runtime it changed", () => {
    const kept = keptWindows();
    expect(kept.kept()).toBeUndefined();
    let heard = 0;
    const off = kept.onChange(() => heard++);
    kept.set(["endue.notes"]);
    expect([...(kept.kept() ?? [])]).toEqual(["endue.notes"]);
    off();
    kept.set([]);
    expect(heard).toBe(1);
  });
});
