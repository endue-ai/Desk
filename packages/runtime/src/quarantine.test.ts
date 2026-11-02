import { describe, expect, it } from "vitest";
import { FAILURES_KEY, QUARANTINED_KEY, Quarantine } from "./quarantine";

const AT = "2026-11-02T09:00:00.000Z";
const THROWS = "example.throws";

/** The store as the core keeps it for the runtime, and one desk start over it. */
function desk() {
  const data: Record<string, unknown> = {};
  const store = {
    get: async (key: string) => structuredClone(data[key]),
    set: async (key: string, value: unknown) => {
      data[key] = structuredClone(value);
    },
  };
  return { data, start: () => new Quarantine(store, () => AT) };
}

describe("Quarantine", () => {
  it("counts a failure once per start and quarantines on the third start in a row", async () => {
    const { data, start } = desk();
    const first = start();
    expect(await first.failed(THROWS, "0.1.0")).toBe(false);
    expect(await first.failed(THROWS, "0.1.0")).toBe(false);
    expect(data[FAILURES_KEY]).toEqual({ [THROWS]: { version: "0.1.0", starts: 1 } });

    expect(await start().failed(THROWS, "0.1.0")).toBe(false);
    expect(data[FAILURES_KEY]).toEqual({ [THROWS]: { version: "0.1.0", starts: 2 } });

    const third = start();
    expect(await third.failed(THROWS, "0.1.0")).toBe(true);
    expect(data[QUARANTINED_KEY]).toEqual([{ id: THROWS, version: "0.1.0", at: AT }]);
    expect(data[FAILURES_KEY]).toEqual({});
    expect(await third.list()).toEqual([{ id: THROWS, version: "0.1.0", at: AT }]);
  });

  it("starts the count again after a start whose frame got ready", async () => {
    const { data, start } = desk();
    await start().failed(THROWS, "0.1.0");
    await start().failed(THROWS, "0.1.0");
    await start().ready(THROWS);
    expect(data[FAILURES_KEY]).toEqual({});
    expect(await start().failed(THROWS, "0.1.0")).toBe(false);
    expect(await start().failed(THROWS, "0.1.0")).toBe(false);
    expect(data[QUARANTINED_KEY]).toBeUndefined();
  });

  it("lets a plugin go when a new version is installed or the person turns it on", async () => {
    const { data, start } = desk();
    for (let i = 0; i < 3; i++) await start().failed(THROWS, "0.1.0");
    expect(await start().list()).toHaveLength(1);

    const same = start();
    await same.prune([{ id: THROWS, version: "0.1.0" }]);
    expect(await same.list()).toHaveLength(1);

    const updated = start();
    await updated.prune([{ id: THROWS, version: "0.2.0" }]);
    expect(await updated.list()).toEqual([]);

    for (let i = 0; i < 3; i++) await start().failed(THROWS, "0.2.0");
    const turnedOn = start();
    await turnedOn.release(THROWS);
    expect(await turnedOn.list()).toEqual([]);
    expect(data[FAILURES_KEY]).toEqual({});
  });
});
