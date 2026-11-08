import { afterEach, expect, it, vi } from "vitest";
import { pacer } from "../../lib/djvu/pace.js";

afterEach(() => vi.useRealTimers());

it("becomes due at 25 ms and starts a fresh budget after yielding", async () => {
  vi.useFakeTimers({ toFake: ["performance", "setTimeout"] });
  const pace = pacer();
  expect(pace.due()).toBe(false);
  await vi.advanceTimersByTimeAsync(24);
  expect(pace.due()).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(pace.due()).toBe(true);
  const rested = pace.rest();
  await vi.runAllTimersAsync();
  await rested;
  expect(pace.due()).toBe(false);
});

it("rejects cancellation before and during a yielded wait", async () => {
  vi.useFakeTimers({ toFake: ["performance", "setTimeout"] });
  const early = new AbortController();
  early.abort();
  expect(() => pacer(early.signal).check()).toThrow();
  await expect(pacer(early.signal).rest()).rejects.toMatchObject({ name: "AbortError" });
  const late = new AbortController();
  const outcome = pacer(late.signal)
    .rest()
    .catch((error: unknown) => error);
  late.abort();
  await vi.runAllTimersAsync();
  expect(await outcome).toMatchObject({ name: "AbortError" });
});
