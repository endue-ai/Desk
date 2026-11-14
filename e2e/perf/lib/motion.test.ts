import { describe, expect, it } from "vitest";
import type { Image } from "../../support/png";
import {
  captured,
  type Line,
  parseTrace,
  SHADOW,
  shakes,
  sharpness,
  strayed,
  timing,
} from "./motion";
import { failed, type RunFindings, table, verdicts, worst } from "./motion-verdicts";

const line = (t: number, e: string, f: unknown = {}): Line => ({ t, e, f });
const at = (x: number) => ({ windows: [{ id: "w", rect: [x, 10, 40, 30], own: true, parts: 0 }] });

/** A shake with frames `gaps` ms apart through a one-second swing, and a capture at rest and one mid-swing. */
function trace(gaps: number[]): Line[] {
  const lines = [line(0, "start"), line(10, "shake", { phase: "press", tag: "s" })];
  lines.push(line(20, "win", at(100)), line(21, "capture", { tag: "rest", path: "r", ok: true }));
  lines.push(line(100, "shake", { phase: "swing", on: true }));
  let t = 100;
  for (const gap of gaps) {
    t += gap;
    lines.push(
      line(t - 1, "move", { x: t, y: 0 }),
      line(t, "frame", { shown: false, tickMs: 2, sceneMs: 1 }),
    );
  }
  lines.push(
    line(500, "win", at(180)),
    line(501, "capture", { tag: "swing", path: "m", ok: true }),
  );
  lines.push(line(1100, "shake", { phase: "swing", on: false }));
  lines.push(line(1200, "shake", { phase: "release" }), line(1300, "shake", { phase: "done" }));
  return lines;
}

/** A `w`×`h` image whose pixel at (x, y) is `paint(x, y)` grey. */
function image(w: number, h: number, paint: (x: number, y: number) => number): Image {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      data.set([paint(x, y), paint(x, y), paint(x, y), 255], (y * w + x) * 4);
    }
  }
  return { width: w, height: h, data, scale: 1 };
}

describe("the frame trace", () => {
  it("reads its lines and skips a torn last one", () => {
    expect(parseTrace('{"t":1,"e":"a","f":{}}\n\n{"t":2,"e":"b","f":{}}\n{"t":3,"e')).toHaveLength(
      2,
    );
  });

  it("finds a shake from its press to its end, with its swing", () => {
    const [s] = shakes(trace([16.7]));
    expect(s).toMatchObject({ tag: "s", pressed: 10, swing: [100, 1100], done: 1300 });
    expect(shakes(trace([16.7]).slice(0, -1))).toEqual([]);
  });

  it("times the swing's frames: the rate, the intervals and those over the limit", () => {
    const gaps = [...Array(55).fill(16.7), 40, 40];
    const t = timing(shakes(trace(gaps))[0] as never, 25, false);
    expect(t.frames).toBe(57);
    expect(t.fps).toBe(57);
    expect(t.long).toBe(2);
    expect(t.longShare).toBeCloseTo(2 / 56);
    expect(t.intervals.max).toBe(40);
    expect(t.unseen).toBe(57);
    expect(timing(shakes(trace(gaps))[0] as never, 25, true).frames).toBe(0);
  });

  it("says where the window was drawn in each frame read back: the scene laid out before it", () => {
    const frames = captured(shakes(trace([16.7]))[0] as never, "w");
    expect(frames.map((f) => [f.tag, f.rect.x])).toEqual([
      ["rest", 100],
      ["swing", 180],
    ]);
  });
});

describe("a window's own pixels", () => {
  const text = (x: number, y: number) => (((x >> 1) + (y >> 2)) % 3 === 0 ? 230 : 20);
  const rect = { x: 10, y: 10, w: 64, h: 40 };

  it("holds for its picture drawn elsewhere and half a pixel off", () => {
    const moved = image(200, 80, (x, y) => text(x - 50, y));
    const half = image(200, 80, (x, y) => (text(x - 50, y) + text(x - 51, y)) / 2);
    const rest = image(200, 80, text);
    expect(strayed(rest, rect, moved, { ...rect, x: 60 }).differing).toBe(0);
    expect(strayed(rest, rect, half, { ...rect, x: 60.5 }).differing).toBe(0);
  });

  it("fails where another picture shows in its place", () => {
    const rest = image(200, 80, text);
    const other = image(200, 80, (x, y) => (x > 90 && y < 30 ? 128 : text(x - 50, y)));
    expect(strayed(rest, rect, other, { ...rect, x: 60 }).differing).toBeGreaterThan(4);
  });

  it("leaves out what lies over every window, the desk's bars", () => {
    const rest = image(200, 80, text);
    const other = image(200, 80, (x, y) => (x > 90 && y < 30 ? 128 : text(x - 50, y)));
    const bar = { x: 88, y: 0, w: 112, h: 32 };
    const judged = strayed(rest, rect, other, { ...rect, x: 60 }, undefined, { b: [bar] });
    expect(judged.differing).toBe(0);
    expect(judged.blocks).toBeLessThan(strayed(rest, rect, rest, rect).blocks);
  });

  it("takes what lies over every window with its shadow (#269)", () => {
    const lines = [
      line(1, "win", { ...at(100), over: [[10, 20, 30, 40]] }),
      line(2, "capture", { tag: "swing", path: "s", ok: true }),
    ];
    const shake = { tag: "s", pressed: 0, swing: [0, 3] as [number, number], released: 3, done: 3 };
    const [frame] = captured({ ...shake, lines }, "w");
    const { above, below, side } = SHADOW;
    expect(frame?.over).toEqual([
      { x: 10 - side, y: 20 - above, w: 30 + 2 * side, h: 40 + above + below },
    ]);
  });

  it("is softer drawn at a fractional place than at a whole pixel", () => {
    // Strokes a pixel wide, as text has, drawn 0.4 px to the right.
    const stroke = (x: number, y: number) => ((x + 2 * y) % 5 === 0 ? 230 : 20);
    const whole = image(100, 60, stroke);
    const blended = image(100, 60, (x, y) => 0.6 * stroke(x, y) + 0.4 * stroke(x - 1, y));
    expect(sharpness(whole, rect)).toBeGreaterThan(sharpness(blended, rect) * 1.15);
  });
});

describe("the gate's verdicts", () => {
  const good: RunFindings = {
    fps: 59.9,
    longShare: 0,
    intervalP95: 18,
    intervalMax: 21,
    swingFrames: 10,
    foreignFrames: 0,
    fromDeskPage: 0,
    restSharpness: 0.73,
    stopped: [],
    loopTurns: 100,
    loopStopped: [],
  };
  const limits = {
    minFps: 55,
    longIntervalMs: 25,
    maxLongShare: 0.02,
    maxForeignFrames: 0,
    foreignBlocks: 4,
    minRestSharpness: 0.95,
    maxUnfitFrames: 0,
  };

  it("takes the worst of the runs", () => {
    const w = worst([
      good,
      { ...good, fps: 50, foreignFrames: 2, stopped: ["desk"], loopStopped: ["desk"] },
    ]);
    expect(w).toMatchObject({
      fps: 50,
      foreignFrames: 2,
      swingFrames: 20,
      stopped: ["run 2: desk"],
      loopTurns: 200,
      loopStopped: ["run 2: desk"],
    });
  });

  it("fails a check past its limit, and reports a known one without failing", () => {
    const known = { soft: "#250" };
    expect(failed(verdicts(good, limits, known))).toBe(false);
    expect(failed(verdicts({ ...good, fps: 54 }, limits, known))).toBe(true);
    expect(failed(verdicts({ ...good, foreignFrames: 1 }, limits, known))).toBe(true);
    expect(failed(verdicts({ ...good, stopped: ["desk"] }, limits, known))).toBe(true);
    expect(failed(verdicts({ ...good, loopStopped: ["main.endue-terminal"] }, limits, known))).toBe(
      true,
    );
    expect(failed(verdicts({ ...good, loopTurns: 0 }, limits, known)), "no loop ran").toBe(true);
    expect(failed(verdicts({ ...good, invalid: "no frames" }, limits, known))).toBe(true);
    expect(failed(verdicts(good, limits))).toBe(true);
    expect(table(verdicts(good, limits, known))).toContain("known failure (#250)");
  });

  it("fails a known failure that passes, until it leaves the known list", () => {
    const fixed = { ...good, restSharpness: 1 };
    const all = verdicts(fixed, limits, { soft: "#250" });
    expect(failed(all)).toBe(true);
    expect(table(all)).toContain("FIXED: take it out of known (#250)");
    expect(failed(verdicts(fixed, limits))).toBe(false);
  });
});
