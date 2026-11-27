import { describe, expect, it } from "vitest";
import type { Image } from "../../support/png";
import {
  busyDrops,
  captured,
  displayRate,
  gripOf,
  type Line,
  parseTrace,
  SHADOW,
  shakes,
  sharpness,
  strayed,
  swingRoom,
  timing,
} from "./motion";
import { failed, minFpsAt, type RunFindings, table, verdicts, worst } from "./motion-verdicts";

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
    hz: 60,
    busyLoops: 12,
    busyDropped: 0,
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

describe("the display's rate (#249)", () => {
  const good: RunFindings = {
    fps: 59.9,
    longShare: 0,
    intervalP95: 17,
    intervalMax: 18,
    swingFrames: 10,
    foreignFrames: 0,
    fromDeskPage: 0,
    restSharpness: 1,
    stopped: [],
    loopTurns: 100,
    loopStopped: [],
    hz: 60,
    busyLoops: 12,
    busyDropped: 0,
  };
  const limits = {
    minFps: { "60": 58, "120": 110 },
    longIntervalMs: 25,
    maxLongShare: 0.01,
    maxForeignFrames: 0,
    foreignBlocks: 4,
    minRestSharpness: 0.95,
    maxUnfitFrames: 0,
  };
  const check = (f: RunFindings, name: string) => verdicts(f, limits).find((v) => v.check === name);

  it("judges frames a second against the display's rate", () => {
    expect(check({ ...good, hz: 120, fps: 110 }, "fps")?.passed).toBe(true);
    expect(check({ ...good, hz: 120, fps: 109 }, "fps")?.passed).toBe(false);
    expect(check({ ...good, hz: 60, fps: 58 }, "fps")?.passed).toBe(true);
    expect(check({ ...good, hz: 60, fps: 57 }, "fps")?.passed).toBe(false);
    expect(minFpsAt(limits, 144), "a rate not listed: the nearest one's share").toBe(132);
    expect(minFpsAt({ ...limits, minFps: 55 }, 120), "one number for every rate").toBe(55);
    // `busy`: the shake with a 20 ms busy loop on the main thread fails one frame dropped.
    expect(check(good, "busy")?.passed).toBe(true);
    expect(check({ ...good, busyDropped: 1 }, "busy")?.passed).toBe(false);
    expect(failed(verdicts({ ...good, busyDropped: 1 }, limits))).toBe(true);
    expect(check({ ...good, busyLoops: 0 }, "busy")?.passed, "no busy loop ran").toBe(false);
    expect(failed(verdicts(good, limits))).toBe(false);
  });

  it("reads the display's rate from the trace, 60 where it names none", () => {
    expect(displayRate([line(0, "start"), line(1, "display", { hz: 120 })])).toBe(120);
    expect(displayRate([line(0, "start")])).toBe(60);
  });

  it("counts a frame a busy main thread dropped: a gap of a display interval and a half", () => {
    const frames = (gaps: number[], from = 100) => {
      let t = from;
      return gaps.map((gap) => {
        t += gap;
        return line(t, "frame", { shown: false });
      });
    };
    const shake = (lines: Line[]) => ({
      tag: "busy",
      pressed: 0,
      swing: [100, 1000] as [number, number],
      released: 1000,
      done: 1000,
      lines: [...lines].sort((a, b) => a.t - b.t),
    });
    const busy = (t: number) => line(t, "busy", { ms: 20 });
    // On the display's beat across the busy loop: nothing dropped.
    const kept = shake([...frames(Array(30).fill(16.7)), busy(300)]);
    expect(busyDrops(kept, 60)).toEqual({ loops: 1, dropped: 0 });
    // The loop held the frame after it: two intervals in one.
    const held = shake([
      ...frames([...Array(11).fill(16.7), 33.4, ...Array(10).fill(16.7)]),
      busy(290),
    ]);
    expect(busyDrops(held, 60)).toEqual({ loops: 1, dropped: 1 });
    // On a 120 Hz display 20 ms is more than a frame and a half.
    const fast = shake([...frames(Array(40).fill(8.3)), busy(200)]);
    expect(busyDrops(fast, 120)).toEqual({ loops: 1, dropped: 0 });
    // A busy loop outside the swing is not judged.
    expect(busyDrops(shake([...frames([16.7]), busy(50)]), 60).loops).toBe(0);
  });
});

describe("the shake's grip", () => {
  it("grips a window's title bar between its icon and its tools", () => {
    // The Plugins window of 2026-11-16: 40 % of its width, x 513, lay on its tools (#331).
    expect(gripOf([409, 445, 261, 211], [37, 171])).toEqual([473, 461]);
    expect(gripOf([100, 50, 800, 400], [37, 171])).toEqual([433, 66]);
    expect(gripOf([100, 50, 200, 400], [37, 171]), "no room between them").toBeUndefined();
    expect(gripOf([100, 50, 800, 400], undefined), "the shell named no room").toBeUndefined();
  });

  it("moves a window that cannot swing where it is to the desk's middle, on whole pixels", () => {
    // The sidebar of 2026-11-19: its slot lay within 200 px of the right edge of a 1080 wide desk.
    // Moved only as far as the edge, its swing ran under the rail there (2 foreign frames of 10).
    expect(swingRoom([714, 254, 261, 211], 1080, 200)).toEqual([-304, 0]);
    expect(swingRoom([100, 50, 300, 200], 1080, 200), "too near the left edge").toEqual([290, 0]);
    expect(swingRoom([400, 50, 300, 200], 1080, 200), "room on both sides").toEqual([0, 0]);
    expect(swingRoom([400.4, 50.6, 300, 200], 1080, 200), "to whole pixels").toEqual([-0.4, 0.4]);
    expect(swingRoom([300, 50, 700, 200], 1080, 200), "wider than the room").toBeUndefined();
  });
});
