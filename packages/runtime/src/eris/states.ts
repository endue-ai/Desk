import { clamp01, cubicBezier } from "../ease";
import { type Vec3, VIEW_IDLE, VIEW_THINKING } from "./mesh";

export const ERIS_STATES = ["idle", "listening", "thinking", "done", "heads-up", "oops"] as const;
export type ErisState = (typeof ERIS_STATES)[number];

/** How one state bends the same mesh. Lengths are fractions of the radius R unless noted. */
export interface Look {
  view: Vec3;
  goldToward: readonly [number, number];
  /** Multiplies every alpha. */
  brightness: number;
  /** Push every face along its normal by `push · R · s`. */
  push: number;
  /** Push only the gold face along its normal, and outline where it was. */
  goldPop: number;
  /** Per-face misalignment, in pixels at the 520 px reference size, times s. */
  jitterPx: number;
  lines: "frost" | "gold";
  gold: "bright" | "dim";
  halo: boolean;
  core: { scale: number; opacity: number; breathe: boolean };
  /** Turns about the view axis, radians per second. */
  spin: number;
  dysnomia: { x: number; y: number; tail: boolean; spark: boolean };
}

const base: Look = {
  view: VIEW_IDLE,
  goldToward: [1, 1],
  brightness: 0.85,
  push: 0,
  goldPop: 0,
  jitterPx: 0,
  lines: "frost",
  gold: "bright",
  halo: false,
  core: { scale: 1, opacity: 1, breathe: true },
  spin: (2 * Math.PI) / 90,
  dysnomia: { x: 0.81, y: 0.72, tail: false, spark: false },
};

export const LOOKS: Record<ErisState, Look> = {
  idle: base,
  listening: {
    ...base,
    brightness: 1.25,
    push: 0.12,
    core: { scale: 1.2, opacity: 0.9, breathe: false },
  },
  thinking: {
    ...base,
    view: VIEW_THINKING,
    goldToward: [-1, 1],
    spin: (2 * Math.PI) / 18,
    dysnomia: { x: 0.2, y: 0.18, tail: true, spark: false },
  },
  done: { ...base, brightness: 1, lines: "gold", halo: true },
  "heads-up": {
    ...base,
    brightness: 1,
    goldPop: 0.13,
    dysnomia: { ...base.dysnomia, spark: true },
  },
  oops: {
    ...base,
    brightness: 0.55,
    jitterPx: 7,
    gold: "dim",
    core: { scale: 1, opacity: 0.3, breathe: false },
    spin: 0,
  },
};

/** Moving from one state's look to the next takes this long; reduced motion jumps. */
export const LOOK_MS = 420;
/** How long she stays idle, silent and settled before her idle motion rests (ADR 0164). */
export const REST_MS = 10_000;
const glide = cubicBezier(0.2, 0.7, 0.2, 1);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** A look between `a` and `b` (t in 0..1): numbers glide, switches flip halfway. */
export function mixLook(a: Look, b: Look, t: number): Look {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const flip = t < 0.5 ? a : b;
  return {
    view: [
      mix(a.view[0], b.view[0], t),
      mix(a.view[1], b.view[1], t),
      mix(a.view[2], b.view[2], t),
    ],
    goldToward: flip.goldToward,
    brightness: mix(a.brightness, b.brightness, t),
    push: mix(a.push, b.push, t),
    goldPop: mix(a.goldPop, b.goldPop, t),
    jitterPx: mix(a.jitterPx, b.jitterPx, t),
    lines: flip.lines,
    gold: flip.gold,
    halo: flip.halo,
    core: {
      scale: mix(a.core.scale, b.core.scale, t),
      opacity: mix(a.core.opacity, b.core.opacity, t),
      breathe: flip.core.breathe,
    },
    spin: mix(a.spin, b.spin, t),
    dysnomia: {
      x: mix(a.dysnomia.x, b.dysnomia.x, t),
      y: mix(a.dysnomia.y, b.dysnomia.y, t),
      tail: flip.dysnomia.tail,
      spark: flip.dysnomia.spark,
    },
  };
}

export interface LookFrame {
  look: Look;
  /** The state whose gold face shows: the old one for the first half of a change. */
  goldOf: ErisState;
  /** How much of the core's breath shows (0..1); glides like the rest. */
  breath: number;
}

/**
 * Eris's look over time: a new state glides in from wherever she is, even halfway through the last
 * change, so listening, thinking and speaking flow into each other instead of cutting.
 */
export class LookTween {
  #from: Look;
  #fromBreath: number;
  #fromGold: ErisState;
  #to: ErisState;
  #since = Number.NEGATIVE_INFINITY;
  #last: LookFrame;

  constructor(state: ErisState) {
    const look = LOOKS[state];
    this.#from = look;
    this.#fromBreath = look.core.breathe ? 1 : 0;
    this.#fromGold = state;
    this.#to = state;
    this.#last = { look, goldOf: state, breath: this.#fromBreath };
  }

  at(state: ErisState, now: number, reduced: boolean): LookFrame {
    if (state !== this.#to) {
      this.#from = this.#last.look;
      this.#fromBreath = this.#last.breath;
      this.#fromGold = this.#last.goldOf;
      this.#to = state;
      this.#since = now;
    }
    const to = LOOKS[state];
    const t = reduced ? 1 : glide(clamp01((now - this.#since) / LOOK_MS));
    this.#last = {
      look: mixLook(this.#from, to, t),
      goldOf: t < 0.5 ? this.#fromGold : state,
      breath: mix(this.#fromBreath, to.core.breathe ? 1 : 0, t),
    };
    return this.#last;
  }
}

/** Core breath: opacity between .55 and 1 on a 5 s cycle. */
export function coreBreath(t: number): number {
  return 0.775 + 0.225 * Math.cos((2 * Math.PI * t) / 5000);
}

/** Body float: ±6 px on a 6 s cycle; Dysnomia floats the other way on 4.5 s. */
export function floatOffset(t: number): { body: number; moon: number } {
  return {
    body: 6 * Math.sin((2 * Math.PI * t) / 6000),
    moon: -4 * Math.sin((2 * Math.PI * t) / 4500),
  };
}
