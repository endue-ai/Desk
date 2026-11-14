// A window's section against its own page during the motion gate's sway (#270, ADR 0201): each
// window page reports, at each frame where its viewport or its section changed size, the page's
// size and the section's box as that frame lays them out (`support/sections.ts`). A frame where
// they differ shows the section laid out for a size its page does not have: cut at the page's
// edge, or with the page's background past it. `sway-sizes` compares a picture with its frame and
// cannot see inside it; this does. Pure: motion-sections.test.ts.

/** A frame of a window page: when (ms), the page's size, and its section's box, CSS pixels. */
export type SectionSample = [
  t: number,
  vw: number,
  vh: number,
  x: number,
  y: number,
  w: number,
  h: number,
];

/** A frame where the section did not fill its page. */
export interface UnfitSection {
  window: string;
  t: number;
  page: number[];
  section: number[];
}

export interface SectionFit {
  /** Frames reported, every window's together, and those whose section did not fill the page. */
  frames: number;
  unfit: number;
  /** The frames, per window. */
  windows: Record<string, { frames: number; unfit: number }>;
  /** The first few unfit frames, for the report. */
  examples: UnfitSection[];
}

/** How far a section's box may be off its page, in CSS pixels: no more than a rounding. */
export const TOLERANCE = 1;
const EXAMPLES = 8;

/** Whether `s` shows a section that fills its page from its top left, within `tolerance`. */
export function fits(s: SectionSample, tolerance = TOLERANCE): boolean {
  const [, vw, vh, x, y, w, h] = s;
  const near = (a: number, b: number) => Math.abs(a - b) <= tolerance;
  return near(x, 0) && near(y, 0) && near(w, vw) && near(h, vh);
}

/** What every window page's frames say. */
export function sectionFit(
  samples: Readonly<Record<string, readonly SectionSample[]>>,
  tolerance = TOLERANCE,
): SectionFit {
  const fit: SectionFit = { frames: 0, unfit: 0, windows: {}, examples: [] };
  for (const [window, frames] of Object.entries(samples)) {
    const off = frames.filter((s) => !fits(s, tolerance));
    fit.windows[window] = { frames: frames.length, unfit: off.length };
    fit.frames += frames.length;
    fit.unfit += off.length;
    for (const [t, vw, vh, x, y, w, h] of off) {
      if (fit.examples.length < EXAMPLES) {
        fit.examples.push({ window, t, page: [vw, vh], section: [x, y, w, h] });
      }
    }
  }
  return fit;
}
