// @vitest-environment jsdom
// Compositor mode (#52): the shell page tells the compositor where every plugin frame is, so its
// off-screen surface is drawn there; an unloaded frame is reported asleep, a closed one not at all.
import { afterEach, describe, expect, it } from "vitest";
import { type LayoutReport, startCompositorLayout, surfaceHostOf } from "./compositor-layout";

const NOTES = "desk-plugin://main.endue-notes/endue.notes/ui/index.html?v=1";

describe("compositor layout", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("knows a plugin surface's own host and nothing else", () => {
    expect(surfaceHostOf(NOTES)).toBe("main.endue-notes");
    expect(surfaceHostOf("desk-plugin://localhost/_desk/palette/index.html")).toBeUndefined();
    expect(surfaceHostOf("desk-app://app/index.html")).toBeUndefined();
    expect(surfaceHostOf("about:blank")).toBeUndefined();
  });

  it("reports each frame once and again only when it changed, an unloaded one as asleep", () => {
    const callbacks: FrameRequestCallback[] = [];
    const win = window as Window & typeof globalThis;
    win.requestAnimationFrame = (cb) => callbacks.push(cb);
    win.cancelAnimationFrame = () => {};
    const section = document.createElement("section");
    section.dataset.surface = "endue.notes";
    const frame = document.createElement("iframe");
    frame.src = NOTES;
    section.append(frame);
    document.body.append(section);
    const reports: LayoutReport[] = [];
    const stop = startCompositorLayout(win, (report) => reports.push(report));
    const tick = () => callbacks.shift()?.(0);
    tick();
    tick();
    expect(reports).toHaveLength(1);
    expect(reports[0]?.surfaces[0]).toMatchObject({
      host: "main.endue-notes",
      src: NOTES,
      asleep: false,
    });
    frame.dispatchEvent(new Event("load"));
    tick();
    expect(reports.at(-1)?.surfaces[0]?.loads).toBe(1);
    frame.remove();
    tick();
    expect(reports.at(-1)?.surfaces[0]).toMatchObject({
      host: "main.endue-notes",
      asleep: true,
      pieces: [],
    });
    section.remove();
    tick();
    expect(reports.at(-1)?.surfaces).toEqual([]);
    expect(reports.map((r) => r.seq)).toEqual([1, 2, 3, 4]);
    stop();
  });
});
