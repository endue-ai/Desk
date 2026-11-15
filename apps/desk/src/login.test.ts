// Start at login (#237): the page tells the shell what desk.login.start is, at once and on every
// change of it, once per value; a telling that fails is said again at the next change.
import { describe, expect, it, vi } from "vitest";
import { followLogin, LOGIN_SETTING } from "./login";

function host(start: unknown) {
  const values: Record<string, unknown> = { [LOGIN_SETTING]: start };
  const listeners = new Set<(keys: string[]) => void>();
  const told: boolean[] = [];
  const errors: unknown[] = [];
  let fail = false;
  return {
    told,
    errors,
    failing: (next: boolean) => {
      fail = next;
    },
    set(key: string, value: unknown) {
      values[key] = value;
      for (const listener of listeners) listener([key]);
    },
    listeners,
    host: {
      settings: {
        get: <T>(key: string, fallback?: T) => (key in values ? values[key] : fallback) as T,
        onChange: (listener: (keys: string[]) => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      tell: (value: boolean) => {
        told.push(value);
        return fail ? Promise.reject(new Error("no shell")) : Promise.resolve();
      },
      report: (error: unknown) => errors.push(error),
    },
  };
}

describe("start at login", () => {
  it("tells the shell the setting at once, off unless it is true", () => {
    for (const [value, said] of [
      [true, true],
      [false, false],
      [undefined, false],
      ["yes", false],
    ] as const) {
      const fake = host(value);
      followLogin(fake.host);
      expect(fake.told).toEqual([said]);
    }
  });

  it("tells it again when the setting changes, once per value, and no more once stopped", () => {
    const fake = host(false);
    const stop = followLogin(fake.host);
    fake.set("desk.theme.scheme", "dark");
    fake.set(LOGIN_SETTING, false);
    expect(fake.told).toEqual([false]);
    fake.set(LOGIN_SETTING, true);
    fake.set(LOGIN_SETTING, false);
    expect(fake.told).toEqual([false, true, false]);
    stop();
    fake.set(LOGIN_SETTING, true);
    expect(fake.told).toEqual([false, true, false]);
  });

  it("reports a telling that failed and says the same value again at the next change", async () => {
    const fake = host(true);
    fake.failing(true);
    followLogin(fake.host);
    await vi.waitFor(() => expect(fake.errors).toHaveLength(1));
    fake.failing(false);
    fake.set(LOGIN_SETTING, true);
    expect(fake.told).toEqual([true, true]);
  });
});
