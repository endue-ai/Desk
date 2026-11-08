import { vi } from "vitest";
import * as pacing from "../../lib/djvu/pace.js";

/** Observe active render segments, excluding time after the decoder has yielded. */
export async function measureRender<T>(
  run: () => Promise<T>,
  { delay = 0, clock = () => performance.now() } = {},
) {
  const nativeTimeout = globalThis.setTimeout;
  const nativePacer = pacing.pacer;
  const timeout = vi
    .spyOn(globalThis, "setTimeout")
    .mockImplementation(((callback: () => void, ms = 0, ...args: unknown[]) =>
      nativeTimeout(callback, ms === 0 ? delay : ms, ...args)) as typeof setTimeout);
  let last = clock();
  let maximum = 0;
  let turns = 0;
  let yields = 0;
  let waiting = 0;
  const timer = setInterval(() => {
    turns++;
  }, 1);
  const factory = vi.spyOn(pacing, "pacer").mockImplementation((signal) => {
    const pace = nativePacer(signal);
    const rest = pace.rest;
    pace.rest = () => {
      const pending = rest();
      const beforeYield = clock();
      maximum = Math.max(maximum, beforeYield - last);
      return pending.finally(() => {
        const resumed = clock();
        waiting = Math.max(waiting, resumed - beforeYield);
        last = resumed;
        yields++;
      });
    };
    return pace;
  });
  try {
    const result = await run();
    maximum = Math.max(maximum, clock() - last);
    return { result, maximum, turns, yields, waiting };
  } finally {
    clearInterval(timer);
    factory.mockRestore();
    timeout.mockRestore();
  }
}
