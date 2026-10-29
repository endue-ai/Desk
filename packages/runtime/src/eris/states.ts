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
