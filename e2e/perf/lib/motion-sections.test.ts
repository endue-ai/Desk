import { describe, expect, it } from "vitest";
import { fits, type SectionSample, sectionFit } from "./motion-sections";
import { type SwayFindings, swayVerdicts, worstSway } from "./motion-verdicts";

const at = (t: number, vw: number, vh: number, w = vw, h = vh, x = 0, y = 0): SectionSample => [
  t,
  vw,
  vh,
  x,
  y,
  w,
  h,
];

describe("a window's section against its own page", () => {
  it("fits when it fills the page from its top left, to a rounding", () => {
    expect(fits(at(0, 640, 400))).toBe(true);
    expect(fits(at(0, 640, 400, 640.5, 399.6))).toBe(true);
  });

  it("does not when laid out for a size ahead of the page (cut) or behind it (padded)", () => {
    expect(fits(at(0, 640, 400, 738, 400))).toBe(false);
    expect(fits(at(0, 640, 400, 640, 352))).toBe(false);
    expect(fits(at(0, 640, 400, 640, 400, 12, 0))).toBe(false);
  });

  it("counts every window's frames and the unfit ones, with the first few for the report", () => {
    const fit = sectionFit({
      "endue.terminal": [at(10, 640, 400), at(26, 650, 405, 698, 438), at(42, 700, 440)],
      "endue.sidebar": [at(12, 328, 211)],
      "endue.notes": [],
    });
    expect(fit.frames).toBe(4);
    expect(fit.unfit).toBe(1);
    expect(fit.windows).toEqual({
      "endue.terminal": { frames: 3, unfit: 1 },
      "endue.sidebar": { frames: 1, unfit: 0 },
      "endue.notes": { frames: 0, unfit: 0 },
    });
    expect(fit.examples).toEqual([
      { window: "endue.terminal", t: 26, page: [650, 405], section: [0, 0, 698, 438] },
    ]);
  });
});

/** A sway that found nothing amiss. */
const clean: SwayFindings = {
  widths: [1024, 1624],
  heights: [600, 1000],
  fps: 59,
  longShare: 0,
  intervalP95: 17,
  intervalMax: 20,
  frames: 900,
  unfitFrames: 0,
  sceneFrames: 0,
  swingFrames: 10,
  foreignFrames: 0,
  stopped: [],
  unsettled: [],
  restSharpness: 1,
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
const sections = (found: SwayFindings) =>
  swayVerdicts(found, limits).find((v) => v.check === "sway-sections");

describe("the sway's sections check", () => {
  it("passes with every section filling its page", () => {
    const v = sections({ ...clean, sectionFrames: 120, unfitSections: 0 });
    expect(v?.passed).toBe(true);
    expect(v?.fails).toBe(false);
  });

  it("fails on a section laid out for another size than its page", () => {
    const v = sections({ ...clean, sectionFrames: 120, unfitSections: 8 });
    expect(v?.value).toBe(8);
    expect(v?.fails).toBe(true);
  });

  it("fails when no window page reported a frame: nothing was measured", () => {
    expect(sections({ ...clean, sectionFrames: 0, unfitSections: 0 })?.fails).toBe(true);
    expect(sections(clean)?.fails).toBe(true);
  });

  it("adds the runs' frames up, a run that measured none counting none", () => {
    const worst = worstSway([
      { ...clean, sectionFrames: 100, unfitSections: 0 },
      { ...clean, sectionFrames: 80, unfitSections: 3 },
      clean,
    ]);
    expect([worst.sectionFrames, worst.unfitSections]).toEqual([180, 3]);
  });
});
