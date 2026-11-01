// The document test's timer-gap observer, extracted so delayed scheduling can be reproduced.
import { vi } from "vitest";

export async function measureRender<T>(
  run: () => Promise<T>,
  { delay = 0, clock = () => performance.now() } = {},
) {
  const nativeTimeout = globalThis.setTimeout;
  const timeout = vi
    .spyOn(globalThis, "setTimeout")
    .mockImplementation(((callback: () => void, ms = 0) =>
      nativeTimeout(callback, ms + delay)) as typeof setTimeout);
  let last = clock();
  let maximum = 0;
  let turns = 0;
  let timer: ReturnType<typeof setTimeout>;
  const tick = () => {
    const now = clock();
    maximum = Math.max(maximum, now - last);
    last = now;
    turns++;
    timer = setTimeout(tick, 0);
  };
  timer = setTimeout(tick, 0);
  try {
    const result = await run();
    return { result, maximum, turns, yields: 0, waiting: 0 };
  } finally {
    clearTimeout(timer);
    timeout.mockRestore();
  }
}
