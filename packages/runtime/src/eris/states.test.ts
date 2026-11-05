import { describe, expect, test } from "vitest";
import { LOOK_MS, LOOKS, LookTween, mixLook } from "./states";

describe("looks glide from one state to the next", () => {
  test("numbers move between the two looks; switches flip halfway", () => {
    const a = LOOKS.idle;
    const b = LOOKS.done;
    const mid = mixLook(a, b, 0.25);
    expect(mid.brightness).toBeCloseTo(a.brightness + (b.brightness - a.brightness) * 0.25);
    expect(mid.lines).toBe("frost");
    expect(mixLook(a, b, 0.75).lines).toBe("gold");
    expect(mixLook(a, b, 1)).toBe(b);
  });

  test("a new state settles after LOOK_MS, turning the view on the way", () => {
    const tween = new LookTween("idle");
    expect(tween.at("idle", 0, false).look).toBe(LOOKS.idle);
    tween.at("thinking", 1000, false);
    const half = tween.at("thinking", 1000 + LOOK_MS / 2, false).look;
    expect(half.view[0]).toBeLessThan(LOOKS.idle.view[0]);
    expect(half.view[0]).toBeGreaterThan(LOOKS.thinking.view[0]);
    expect(tween.at("thinking", 1000 + LOOK_MS, false).look).toBe(LOOKS.thinking);
  });

  test("changing again halfway starts from where she is, and reduced motion jumps", () => {
    const tween = new LookTween("idle");
    tween.at("listening", 0, false);
    const between = tween.at("listening", LOOK_MS / 3, false).look.brightness;
    const next = tween.at("thinking", LOOK_MS / 3, false).look.brightness;
    expect(next).toBeCloseTo(between);
    expect(tween.at("oops", LOOK_MS, true).look).toBe(LOOKS.oops);
  });

  test("the core's breath fades out into listening instead of stopping", () => {
    const tween = new LookTween("idle");
    expect(tween.at("idle", 0, false).breath).toBe(1);
    tween.at("listening", 100, false);
    const fading = tween.at("listening", 100 + LOOK_MS / 4, false).breath;
    expect(fading).toBeGreaterThan(0);
    expect(fading).toBeLessThan(1);
    expect(tween.at("listening", 100 + LOOK_MS, false).breath).toBe(0);
  });
});
