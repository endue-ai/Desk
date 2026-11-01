import { afterEach, expect, it, vi } from "vitest";
import * as pacing from "../../lib/djvu/pace.js";
import { measureRender } from "./timing";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("excludes a delayed yielded wait while a real timer still advances", async () => {
  const measured = await measureRender(
    async () => {
      await pacing.pacer().rest();
      return "finished";
    },
    { delay: 80 },
  );
  expect(measured.result).toBe("finished");
  expect(measured.maximum).toBeLessThan(60);
  expect(measured.waiting).toBeGreaterThanOrEqual(60);
  expect(measured.turns).toBeGreaterThan(0);
  expect(measured.yields).toBe(1);
});

it("includes uninterrupted work after the final yield and detects an exceeded ceiling", async () => {
  let now = 0;
  const measured = await measureRender(
    async () => {
      now = 10;
      const rested = pacing.pacer().rest();
      now = 90;
      await rested;
      now += 61;
    },
    { clock: () => now },
  );
  expect(measured.waiting).toBe(80);
  expect(measured.maximum).toBe(61);
  expect(measured.maximum < 60).toBe(false);
});

it("detects work exceeding the ceiling before the first yield, with no final tail", async () => {
  let now = 0;
  const measured = await measureRender(
    async () => {
      now = 61;
      const rested = pacing.pacer().rest();
      now += 80;
      await rested;
    },
    { clock: () => now },
  );
  expect(measured.waiting).toBe(80);
  expect(measured.maximum).toBe(61);
  expect(measured.maximum < 60).toBe(false);
});

it("restores the pacer and timers when rendering rejects", async () => {
  vi.useFakeTimers();
  const pacer = pacing.pacer;
  const timeout = globalThis.setTimeout;
  const error = new Error("render failed");
  await expect(
    measureRender(async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(pacing.pacer).toBe(pacer);
  expect(globalThis.setTimeout).toBe(timeout);
  expect(vi.getTimerCount()).toBe(0);
});
