/**
 * Sound enters through the rings. Nine log-spaced bands drive the nine sound rings: the user's voice
 * travels from the rim inwards and is absorbed by the core; Eris's voice leaves the core as one pulse
 * per syllable and reaches the rim when the matching glyph appears. Pure: time comes in as arguments.
 */
import type { AudioLevels, Bands } from "../bridge/types";

/** Ring displacement is at most this fraction of R. */
export const MAX_DISPLACEMENT = 0.06;
export const ATTACK_MS = 30;
export const RELEASE_MS = 180;
/** User wave: one ring every 70 ms, rim first. */
export const INWARD_STEP_MS = 70;
/** Eris pulse: rises for 45 ms per ring and reaches the rim (ring 8) 220 ms after it leaves the core. */
export const PULSE_RISE_MS = 45;
export const PULSE_TO_RIM_MS = 220;
export const OUTWARD_STEP_MS = PULSE_TO_RIM_MS / 8;
const BREATH_MS = 6000;
const BREATH_STEP_MS = 140;
const ACTIVE = 0.08;

/** Band edges in Hz: 80–250 → bands 0–2, 250–2k → 3–6, 2k–8k → 7–8, log-spaced inside each range. */
export const BAND_EDGES: readonly number[] = (() => {
  const split = (lo: number, hi: number, n: number) =>
    Array.from({ length: n }, (_, i) => lo * (hi / lo) ** (i / n));
  return [...split(80, 250, 3), ...split(250, 2000, 4), ...split(2000, 8000, 2), 8000];
})();

/** Average analyser bins (0..255, `getByteFrequencyData`, fftSize 256) into nine bands in 0..1. */
export function bandsFromSpectrum(bins: ArrayLike<number>, sampleRate: number): number[] {
  const hzPerBin = sampleRate / 2 / bins.length;
  return Array.from({ length: 9 }, (_, b) => {
    const lo = BAND_EDGES[b] ?? 0;
    const hi = BAND_EDGES[b + 1] ?? lo;
    let sum = 0;
    let n = 0;
    for (let i = Math.floor(lo / hzPerBin); i <= Math.min(bins.length - 1, hi / hzPerBin); i++) {
      sum += bins[i] ?? 0;
      n++;
    }
    return n === 0 ? 0 : sum / n / 255;
  });
}

/** One-pole follower: 30 ms attack, 180 ms release. */
export function follow(current: number, target: number, dtMs: number): number {
  const tau = target > current ? ATTACK_MS : RELEASE_MS;
  return target + (current - target) * Math.exp(-Math.max(0, dtMs) / tau);
}

export interface RingFrame {
  /** Per ring, fraction of R along the face normal; positive is outward. */
  disp: number[];
  /** Per ring, 0..1, how far brightness follows the displacement. */
  glow: number[];
  /** Core scale (1 = rest). */
  core: number;
  mode: "idle" | "listening" | "speaking" | "both";
  /** Both voices at once for 150 ms: Eris takes it as a signal to stop. */
  interrupted: boolean;
}

interface Sample {
  t: number;
  user: number[];
  loud: number;
}

const mean = (b: Bands) => b.reduce((a, v) => a + v, 0) / Math.max(1, b.length);

function pulse(tau: number): number {
  if (tau < 0) return 0;
  if (tau < PULSE_RISE_MS) return tau / PULSE_RISE_MS;
  return Math.exp(-(tau - PULSE_RISE_MS) / 90);
}

/** Stateful wave engine. Call `update` once per frame with the clock's time. */
export class Voice {
  #user = new Array<number>(9).fill(0);
  #eris = 0;
  #last: number | undefined;
  #history: Sample[] = [];
  #pulses: { at: number; amp: number }[] = [];
  #overlapSince: number | undefined;

  /** Schedule Eris pulses at absolute clock times (one per syllable or word). */
  speak(times: number[], amplitude = 1): void {
    for (const at of times) this.#pulses.push({ at, amp: amplitude });
  }

  /** Drop pulses that have not started (Eris stops talking). */
  hush(now: number): void {
    this.#pulses = this.#pulses.filter((p) => p.at <= now);
  }

  update(now: number, levels: AudioLevels, reducedMotion = false): RingFrame {
    const dt = this.#last === undefined ? 16 : now - this.#last;
    this.#last = now;
    this.#user = this.#user.map((v, k) => follow(v, levels.user[k] ?? 0, dt));
    this.#eris = follow(this.#eris, mean(levels.eris), dt);
    const loud = mean(this.#user);
    this.#history.push({ t: now, user: [...this.#user], loud });
    while (this.#history.length > 2 && (this.#history[0]?.t ?? now) < now - 1200) {
      this.#history.shift();
    }
    this.#pulses = this.#pulses.filter((p) => now - p.at < 1500);

    const listening = this.#history.some((s) => s.loud > ACTIVE);
    const speaking = this.#pulses.some((p) => p.at <= now) || this.#eris > ACTIVE;
    const inward = this.#inward(now);
    const outward = this.#outward(now);
    const disp: number[] = [];
    for (let k = 0; k < 9; k++) {
      let d = (inward.disp[k] ?? 0) + (outward[k] ?? 0);
      if (listening && speaking) d *= 1 - Math.exp(-(((k - 4) / 1.3) ** 2));
      if (!listening && !speaking) {
        const phase = (2 * Math.PI * (now - BREATH_STEP_MS * k)) / BREATH_MS;
        d = 0.3 * MAX_DISPLACEMENT * 0.5 * (1 - Math.cos(phase));
      }
      disp.push(d);
    }
    const userNow = loud > ACTIVE;
    const erisNow =
      this.#pulses.some((p) => p.at <= now && now - p.at < 400) || this.#eris > ACTIVE;
    if (userNow && erisNow) this.#overlapSince ??= now;
    else this.#overlapSince = undefined;

    const flash = this.#pulses.reduce((a, p) => a + 0.18 * p.amp * pulse(now - p.at) ** 2, 0);
    const glow = disp.map((d) => Math.min(1, Math.abs(d) / MAX_DISPLACEMENT));
    return {
      disp: reducedMotion ? disp.map(() => 0) : disp,
      glow,
      core: reducedMotion ? 1 : 1 + inward.core + Math.min(0.18, flash),
      mode:
        listening && speaking ? "both" : listening ? "listening" : speaking ? "speaking" : "idle",
      interrupted: this.#overlapSince !== undefined && now - this.#overlapSince >= 150,
    };
  }

  #at(t: number): Sample | undefined {
    let found: Sample | undefined;
    for (const s of this.#history) {
      if (s.t > t) break;
      found = s;
    }
    return found;
  }

  /** Rim first, 70 ms per ring, pulled inwards; the core swells to absorb it. */
  #inward(now: number): { disp: number[]; core: number } {
    const disp = Array.from({ length: 9 }, (_, k) => {
      const s = this.#at(now - INWARD_STEP_MS * (8 - k));
      if (!s) return 0;
      const e = Math.min(1, 0.5 * (s.user[k] ?? 0) + 0.5 * s.loud * 1.6);
      return -MAX_DISPLACEMENT * e;
    });
    const coreSample = this.#at(now - INWARD_STEP_MS * 9);
    return { disp, core: 0.22 * Math.min(1, (coreSample?.loud ?? 0) * 1.6) };
  }

  /** Core first, one ring every 27.5 ms, pushed outwards. */
  #outward(now: number): number[] {
    return Array.from({ length: 9 }, (_, k) =>
      Math.min(
        MAX_DISPLACEMENT,
        this.#pulses.reduce(
          (a, p) => a + MAX_DISPLACEMENT * p.amp * pulse(now - p.at - OUTWARD_STEP_MS * k),
          0,
        ),
      ),
    );
  }
}

/** The ring a wave front is on: where |displacement| peaks. For tests and the render digest. */
export function peakRing(frame: Pick<RingFrame, "disp">): number {
  let best = 0;
  frame.disp.forEach((d, k) => {
    if (Math.abs(d) > Math.abs(frame.disp[best] ?? 0)) best = k;
  });
  return best;
}
