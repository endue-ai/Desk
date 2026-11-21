import { clamp01, cubicBezier } from "../ease";
import { type Vec3, VIEW_IDLE, VIEW_THINKING } from "./mesh";

export const ERIS_STATES = ["idle", "listening", "thinking", "done", "heads-up", "oops"] as const;
export type ErisState = (typeof ERIS_STATES)[number];

/** How one state bends the same mesh. Lengths are fractions of the radius R unless noted. */
export interface Look {
  view: Vec3;
  /** Multiplies every alpha. */
  brightness: number;
  /** Push every face along its normal by `push · R · s`. */
  push: number;
  lines: "frost" | "warning" | "danger";
  halo: boolean;
  core: { scale: number; opacity: number; breathe: boolean };
  /** Turns about the view axis, radians per second. */
  spin: number;
}

const base: Look = {
  view: VIEW_IDLE,
  brightness: 0.85,
  push: 0,
  lines: "frost",
  halo: false,
  core: { scale: 1, opacity: 1, breathe: true },
  spin: (2 * Math.PI) / 90,
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
    spin: (2 * Math.PI) / 18,
  },
  done: { ...base, brightness: 1, halo: true },
  "heads-up": {
    ...base,
    brightness: 1.12,
    lines: "warning",
  },
  oops: {
    ...base,
    brightness: 1.24,
    lines: "danger",
    core: { scale: 1, opacity: 0.3, breathe: false },
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
    brightness: mix(a.brightness, b.brightness, t),
    push: mix(a.push, b.push, t),
    lines: flip.lines,
    halo: flip.halo,
    core: {
      scale: mix(a.core.scale, b.core.scale, t),
      opacity: mix(a.core.opacity, b.core.opacity, t),
      breathe: flip.core.breathe,
    },
    spin: mix(a.spin, b.spin, t),
  };
}

export interface LookFrame {
  look: Look;
  /** How much of the core's breath shows (0..1); glides like the rest. */
  breath: number;
  tremor: number;
}

/**
 * Eris's look over time: a new state glides in from wherever she is, even halfway through the last
 * change, so listening, thinking and speaking flow into each other instead of cutting.
 */
export class LookTween {
  #from: Look;
  #fromBreath: number;
  #to: ErisState;
  #since = Number.NEGATIVE_INFINITY;
  #last: LookFrame;

  constructor(state: ErisState) {
    const look = LOOKS[state];
    this.#from = look;
    this.#fromBreath = look.core.breathe ? 1 : 0;
    this.#to = state;
    this.#last = { look, tremor: 0, breath: this.#fromBreath };
  }

  at(state: ErisState, now: number, reduced: boolean): LookFrame {
    if (state !== this.#to) {
      this.#from = this.#last.look;
      this.#fromBreath = this.#last.breath;
      this.#to = state;
      this.#since = now;
    }
    const to = LOOKS[state];
    const t = reduced ? 1 : glide(clamp01((now - this.#since) / LOOK_MS));
    this.#last = {
      tremor: reduced ? 0 : alertTremor(state, now - this.#since),
      look: mixLook(this.#from, to, t),
      breath: mix(this.#fromBreath, to.core.breathe ? 1 : 0, t),
    };
    return this.#last;
  }
}

/** Alerts briefly move the intact shell. A critical alert has a second, softer pulse. */
function alertTremor(state: ErisState, age: number): number {
  if (state !== "heads-up" && state !== "oops") return 0;
  const second = state === "oops" && age >= 430;
  const t = (age - (second ? 430 : 0)) / 350;
  if (t <= 0 || t >= 1) return 0;
  const strength = state === "oops" ? 1.35 : 0.82;
  return strength * (second ? 0.78 : 1) * Math.sin(Math.PI * t) ** 1.2 * Math.sin(4 * Math.PI * t);
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
