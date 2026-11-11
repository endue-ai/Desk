// The timeline lets go of what it no longer needs to move (#410): animations whose targets left the
// document, and finite ones past their end, with their final state applied. Endless animations on
// connected targets stay held. The Web Animations API is faked: node has none, and the timeline only
// sets currentTime and cancels.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Timeline } from "../ui/timeline.js";

interface FakeEffect {
  target: { isConnected: boolean } | null;
  getComputedTiming(): { endTime: number };
}

class FakeAnimation {
  static made: FakeAnimation[] = [];
  currentTime: number | null = null;
  cancelled = false;
  constructor(
    readonly effect: FakeEffect | null,
    readonly timeline: unknown,
  ) {
    FakeAnimation.made.push(this);
  }
  cancel() {
    this.cancelled = true;
  }
}

/** A clock whose frames the test runs: tick(ms) runs the frame waiting at that time. */
function manualClock() {
  let next: ((at: number) => void) | null = null;
  return {
    frame: (callback: (at: number) => void) => {
      next = callback;
      return 0;
    },
    tick(at: number) {
      const run = next;
      next = null;
      run?.(at);
    },
    /** Whether the timeline asked for a frame that has not come yet. */
    waiting: () => next !== null,
  };
}

/** An element-like target and a document animation on it that ends at `endTime`. */
function animationOn(endTime: number) {
  const target = { isConnected: true };
  const effect: FakeEffect = { target, getComputedTiming: () => ({ endTime }) };
  return { target, animation: { effect, cancel() {} } as unknown as Animation };
}

const original = globalThis.Animation;
beforeEach(() => {
  FakeAnimation.made = [];
  globalThis.Animation = FakeAnimation as unknown as typeof Animation;
});
afterEach(() => {
  globalThis.Animation = original;
});

describe("the timeline lets go", () => {
  it("of animations whose targets left the document", () => {
    const clock = manualClock();
    const timeline = new Timeline(clock);
    const targets = [];
    for (let i = 0; i < 500; i++) {
      const { target, animation } = animationOn(10_000);
      targets.push(target);
      timeline.add(animation);
    }
    clock.tick(0);
    expect(timeline.size).toBe(500);
    for (const target of targets) target.isConnected = false;
    clock.tick(16);
    expect(timeline.size).toBe(0);
    expect(FakeAnimation.made.every((held) => held.cancelled)).toBe(true);
  });

  it("of a finite animation once it ends, with its final state applied", () => {
    const clock = manualClock();
    const timeline = new Timeline(clock);
    timeline.add(animationOn(1000).animation);
    const [held] = FakeAnimation.made;
    clock.tick(0);
    clock.tick(500);
    expect(timeline.size).toBe(1);
    expect(held?.currentTime).toBe(500);
    clock.tick(1016);
    expect(timeline.size).toBe(0);
    expect(held?.currentTime).toBe(1000);
    expect(held?.cancelled).toBe(false);
    clock.tick(2000);
    expect(held?.currentTime).toBe(1000);
  });

  it("but never of an endless animation on a connected target", () => {
    const clock = manualClock();
    const timeline = new Timeline(clock);
    timeline.add(animationOn(Number.POSITIVE_INFINITY).animation);
    const [held] = FakeAnimation.made;
    for (let at = 0; at <= 600_000; at += 16) clock.tick(at);
    expect(timeline.size).toBe(1);
    expect(held?.currentTime).toBe(600_000);
    expect(held?.cancelled).toBe(false);
  });

  it("and, holding nothing, asks for no frame until a cue or an animation comes (#134)", () => {
    const clock = manualClock();
    const timeline = new Timeline(clock);
    const ran: number[] = [];
    timeline.at(100, (now: number) => ran.push(now));
    clock.tick(1000);
    clock.tick(1100);
    expect(ran).toEqual([100]);
    expect(clock.waiting(), "nothing left to move or run").toBe(false);
    // Long after: a cue set from its time keeps its delay, its time going on from where it stopped.
    timeline.at(timeline.time + 300, (now: number) => ran.push(now));
    expect(clock.waiting(), "a cue starts it again").toBe(true);
    clock.tick(60_000);
    expect(timeline.time).toBe(100);
    clock.tick(60_200);
    expect(ran).toEqual([100]);
    clock.tick(60_300);
    expect(ran).toEqual([100, 400]);
    expect(clock.waiting()).toBe(false);
    timeline.add(animationOn(Number.POSITIVE_INFINITY).animation);
    expect(clock.waiting(), "an animation starts it again").toBe(true);
    clock.tick(90_000);
    expect(FakeAnimation.made[0]?.currentTime).toBe(400);
    expect(clock.waiting(), "an endless one keeps it going").toBe(true);
  });

  it("and size is read-only", () => {
    const timeline = new Timeline(manualClock());
    expect(() => {
      (timeline as unknown as { size: number }).size = 5;
    }).toThrow(TypeError);
  });
});
