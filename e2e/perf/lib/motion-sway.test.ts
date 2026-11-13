import { describe, expect, it } from "vitest";
import type { Line, Shake } from "./motion";
import { fitted, lastLaid, overlap, pictures, swayOf, unsettled } from "./motion-sway";
import { failed, type SwayFindings, swayVerdicts, table, worstSway } from "./motion-verdicts";

const line = (t: number, e: string, f: unknown = {}): Line => ({ t, e, f });

/** A layout on an app of `vw`×`vh` at scale 2: window `w` at 100, 100, `size` wide and 100 high,
 * its picture `picture` device pixels; the desk's page `page`. */
function laid(
  vw: number,
  vh: number,
  size: number,
  picture: number[],
  page = [vw * 2, vh * 2],
  screen = [vw, vh],
) {
  return {
    screen,
    windows: [{ id: "w", rect: [100, 100, size, 100] }],
    surfaces: [
      ["window:w", 100, 100, size, 100],
      ["endue.sidebar", 0, 0, 10, 10],
    ],
    textures: { "window:w": picture, "endue.sidebar": [1, 1] },
    pageTexture: page,
    viewport: [vw * 2, vh * 2],
    scale: 2,
  };
}

describe("the sway in the trace", () => {
  it("finds the sway that ran to its end, and the part of a swing it overlaps", () => {
    const lines = [
      line(0, "start"),
      line(100, "sway", { phase: "start", tag: "sway" }),
      line(900, "sway", { phase: "end" }),
    ];
    expect(swayOf(lines)).toEqual({ start: 100, end: 900, cut: false });
    expect(swayOf([...lines.slice(0, 2), line(400, "frame")])).toEqual({
      start: 100,
      end: 400,
      cut: true,
    });
    expect(swayOf(lines.slice(0, 1))).toBeUndefined();
    const shake = { swing: [50, 700], lines: [] } as unknown as Shake;
    expect(overlap(shake, { start: 100, end: 900, cut: false })?.swing).toEqual([100, 700]);
    expect(overlap(shake, { start: 800, end: 900, cut: false })).toBeUndefined();
  });

  it("tells a picture of the window's size from one cut or padded, forgiving a pixel", () => {
    expect(fitted([401, 200], 200, 100, 2)).toBe("fits");
    expect(fitted([480, 200], 200, 100, 2)).toBe("cut");
    expect(fitted([400, 180], 200, 100, 2)).toBe("padded");
    expect(fitted(undefined, 200, 100, 2)).toBeUndefined();
  });

  it("counts the frames that showed a picture laid out for another size, by the layout before each", () => {
    const lines = [
      line(10, "win", laid(1200, 800, 200, [400, 200])),
      line(20, "frame"),
      line(30, "win", laid(1000, 700, 180, [400, 200], [2400, 1600], [1200, 800])),
      line(40, "frame"),
      line(50, "frame"),
      line(60, "win", laid(1000, 700, 180, [360, 200], [2400, 1600])),
      line(70, "frame"),
      line(80, "frame"),
    ];
    const seen = pictures(lines, 15, 75);
    // The page's picture behind the app window is drawn cropped or padded; behind its own scene,
    // the frame shows the page laid out for another size.
    expect(seen).toMatchObject({ frames: 4, unfit: 2, deskUnfit: 1, deskStale: 3 });
    expect(seen.windows).toEqual({ "window:w": { cut: 2, padded: 0 } });
    expect(seen.widths).toEqual([1000, 1200]);
    expect(seen.heights).toEqual([700, 800]);
    expect(pictures(lines, 100, 200)).toMatchObject({ frames: 0, widths: [0, 0] });
  });

  it("says what is amiss once the app window settled", () => {
    const good = line(10, "win", laid(1200, 800, 200, [400, 200]));
    expect(unsettled(good)).toEqual([]);
    expect(unsettled(lastLaid([good, line(20, "win", { windows: [], surfaces: [] })]))).toEqual([]);
    const off = laid(1200, 800, 200, [360, 200], [2000, 1600]);
    off.windows[0] = { id: "w", rect: [1100, 100, 200, 100] };
    off.screen = [1000, 800];
    const faults = unsettled(line(10, "win", off));
    expect(faults).toHaveLength(5);
    expect(faults[0]).toContain("the desk's page is 2000×1600");
    expect(faults[1]).toContain("laid its scene out for 1000×800, not the app's 1200×800");
    expect(faults[2]).toContain("outside the app's 1200×800");
    expect(faults[3]).toContain("is drawn at 100,100,200,100, not at 1100,100,200,100");
    expect(faults[4]).toContain("picture is 360×200 for 200×100 (padded)");
    const unpaged = laid(1200, 800, 200, [400, 200]);
    unpaged.surfaces = [];
    expect(unsettled(line(10, "win", unpaged))).toEqual(["w is not drawn from its own page"]);
    expect(unsettled(undefined)).toHaveLength(1);
  });
});

describe("the sway's verdicts", () => {
  const limits = {
    minFps: 55,
    longIntervalMs: 25,
    maxLongShare: 0.02,
    maxForeignFrames: 0,
    foreignBlocks: 4,
    minRestSharpness: 0.95,
    maxUnfitFrames: 0,
  };
  const good: SwayFindings = {
    widths: [1024, 1624],
    heights: [600, 1000],
    fps: 59.8,
    longShare: 0,
    intervalP95: 17,
    intervalMax: 20,
    frames: 280,
    unfitFrames: 0,
    sceneFrames: 0,
    swingFrames: 4,
    foreignFrames: 0,
    stopped: [],
    unsettled: [],
    restSharpness: 1,
  };

  it("takes the worst of the runs, a sharpness only from the runs that measured one", () => {
    const bad = { ...good, widths: [900, 1500], fps: 40, unfitFrames: 3, stopped: ["desk"] };
    const w = worstSway([good, { ...bad, restSharpness: null, unsettled: ["w off"] }]);
    const unmeasured = worstSway([
      { ...good, unsettled: null },
      { ...good, unsettled: ["w off"] },
    ]);
    expect(unmeasured.unsettled).toEqual(["run 2: w off"]);
    expect(worstSway([{ ...good, unsettled: null }]).unsettled).toBeNull();
    expect(w).toMatchObject({
      widths: [900, 1624],
      fps: 40,
      frames: 560,
      unfitFrames: 3,
      stopped: ["run 2: desk"],
      unsettled: ["run 2: w off"],
      restSharpness: 1,
    });
    expect(worstSway([{ ...good, restSharpness: null }]).restSharpness).toBeNull();
  });

  it("passes a clean sway and fails each check past its limit", () => {
    expect(failed(swayVerdicts(good, limits))).toBe(false);
    for (const worse of [
      { fps: 54 },
      { longShare: 0.05 },
      { foreignFrames: 1 },
      { swingFrames: 0 },
      { unfitFrames: 1 },
      { sceneFrames: 1 },
      { frames: 0 },
      { stopped: ["desk stalled"] },
      { unsettled: ["w off"] },
      { unsettled: null },
      { restSharpness: 0.8 },
      { restSharpness: null },
      { invalid: "the sway did not run" },
    ]) {
      expect(failed(swayVerdicts({ ...good, ...worse }, limits))).toBe(true);
    }
  });

  it("names its checks apart from the single shake's, so each can be known on its own", () => {
    const known = { "sway-painting": "#248", "sway-sizes": "#252" };
    const all = swayVerdicts({ ...good, stopped: ["desk"], unfitFrames: 9 }, limits, known);
    expect(failed(all)).toBe(false);
    expect(table(all)).toContain("known failure (#248)");
    expect(table(all)).toContain("known failure (#252)");
    expect(failed(swayVerdicts(good, limits, known))).toBe(true);
  });

  it("reports a failure seen only at times as known, and passes it when it passes", () => {
    const sometimes = { "sway-painting": "#248" };
    const stalled = swayVerdicts({ ...good, stopped: ["desk stalled"] }, limits, {}, sometimes);
    expect(failed(stalled)).toBe(false);
    expect(table(stalled)).toContain("known failure, at times (#248)");
    const clean = swayVerdicts(good, limits, {}, sometimes);
    expect(failed(clean)).toBe(false);
    expect(table(clean)).toContain("pass (fails at times: #248)");
  });
});
