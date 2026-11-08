/**
 * Soul text timing: when each glyph condenses, how long the line holds, how it scatters. Pure, so the
 * same line at the same time always looks the same.
 */
import type { WordTime } from "../bridge/types";
import { clamp01, cubicBezier } from "../ease";

export type SoulStyle = "wisp" | "solemn";

export const GLYPH_STEP_MS = 35;
export const APPEAR_MS = 900;
export const SOLEMN_APPEAR_MS = 1500;
export const DISSOLVE_MS = 1600;
export const SOLEMN_DISSOLVE_MS = 1400;
export const GLYPH_DISSOLVE_MS = 1150;
export const NEXT_LINE_GAP_MS = 300;
export const REDUCED_MS = 200;

const appearEase = cubicBezier(0.2, 0.7, 0.2, 1);
const dissolveEase = cubicBezier(0.55, 0, 0.85, 0.35);

export interface Glyph {
  ch: string;
  /** Index among the line's visible glyphs. */
  k: number;
  /** Absolute time the glyph starts to condense. */
  at: number;
  eris: boolean;
  user: boolean;
}

export interface SoulLine {
  /** Line number since the shell started; seeds the scatter. */
  n: number;
  text: string;
  style: SoulStyle;
  start: number;
  glyphs: Glyph[];
  dissolveAt: number;
  end: number;
}

export interface GlyphLook {
  opacity: number;
  blur: number;
  x: number;
  y: number;
  scale: number;
  rotate: number;
}

export interface PlanOptions {
  style: SoulStyle;
  /** TTS word timestamps (ms after `start`); without them, time is proportional to letters. */
  words?: WordTime[];
  userName?: string;
  /** Shift every glyph (the pulse needs this long to reach the rim). */
  lead?: number;
  reducedMotion?: boolean;
}

const ERIS_WORD = /^[^\p{L}]*E\.?R\.?I\.?S[^\p{L}]*$/iu;
const strip = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();

/** Hold after the last glyph: 1.0 s for a short line up to 1.4 s for 60 letters or more. */
export function holdMs(text: string): number {
  return 1000 + 400 * clamp01(text.length / 60);
}

export function planLine(n: number, text: string, start: number, o: PlanOptions): SoulLine {
  const glyphs: Glyph[] = [];
  const words = text.split(/(\s+)/);
  let k = 0;
  let wordIndex = 0;
  for (const word of words) {
    if (/^\s+$/.test(word) || word === "") continue;
    const at = o.words?.[wordIndex]?.at ?? k * GLYPH_STEP_MS;
    const eris = ERIS_WORD.test(word);
    const user = o.userName !== undefined && strip(word) === strip(o.userName);
    [...word].forEach((ch, i) => {
      glyphs.push({
        ch,
        k,
        at: start + (o.lead ?? 0) + at + i * GLYPH_STEP_MS,
        eris: eris && /[eris]/i.test(ch),
        user,
      });
      k++;
    });
    wordIndex++;
  }
  const appear = o.reducedMotion ? REDUCED_MS : o.style === "solemn" ? SOLEMN_APPEAR_MS : APPEAR_MS;
  const lastAt = o.style === "solemn" || o.reducedMotion ? start : (glyphs.at(-1)?.at ?? start);
  const dissolveAt = lastAt + appear + holdMs(text);
  const out = o.reducedMotion
    ? REDUCED_MS
    : o.style === "solemn"
      ? SOLEMN_DISSOLVE_MS
      : DISSOLVE_MS;
  return { n, text, style: o.style, start, glyphs, dissolveAt, end: dissolveAt + out };
}

/** Deterministic scatter for glyph k of line n. */
export function scatter(k: number, n: number) {
  return {
    delay: (k * 73 + n * 151) % 450,
    rise: 20 + ((k * 37 + n * 11) % 21),
    dx: ((k * 53 + n * 29) % 25) - 12,
    rotate: ((k * 17 + n * 7) % 13) - 6,
  };
}

const REST: GlyphLook = { opacity: 1, blur: 0, x: 0, y: 0, scale: 1, rotate: 0 };

export function wispGlyph(line: SoulLine, g: Glyph, now: number): GlyphLook {
  if (now >= line.dissolveAt) {
    const s = scatter(g.k, line.n);
    const t = dissolveEase(clamp01((now - line.dissolveAt - s.delay) / GLYPH_DISSOLVE_MS));
    return {
      opacity: 1 - t,
      blur: 10 * t,
      x: s.dx * t,
      y: -s.rise * t,
      scale: 1,
      rotate: s.rotate * t,
    };
  }
  const t = appearEase(clamp01((now - g.at) / APPEAR_MS));
  if (t >= 1) return REST;
  return {
    opacity: t,
    blur: 14 * (1 - t),
    x: 0,
    y: 8 * (1 - t),
    scale: 1.12 - 0.12 * t,
    rotate: 0,
  };
}

/** Solemn and reduced-motion lines animate as a whole: opacity and letter spacing (em). */
export function lineLook(line: SoulLine, now: number, reduced: boolean) {
  if (reduced) {
    const fadeIn = clamp01((now - line.start) / REDUCED_MS);
    const fadeOut = clamp01((now - line.dissolveAt) / REDUCED_MS);
    return { opacity: Math.min(fadeIn, 1 - fadeOut), spacing: line.style === "solemn" ? 0.01 : 0 };
  }
  const fadeIn = clamp01((now - line.start) / SOLEMN_APPEAR_MS);
  const out = clamp01((now - line.dissolveAt) / SOLEMN_DISSOLVE_MS);
  return { opacity: Math.min(fadeIn, 1 - out), spacing: 0.01 + 0.13 * out };
}

/** When the next line may start: 300 ms after the previous one begins to scatter. */
export function nextStart(previous: SoulLine | undefined, now: number): number {
  return previous ? Math.max(now, previous.dissolveAt + NEXT_LINE_GAP_MS) : now;
}
