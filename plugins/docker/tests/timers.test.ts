import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "./harness";

describe("the platform's timers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("are called as functions, so a browser never says Illegal invocation", async () => {
    const real = globalThis.setTimeout;
    // As a browser's setTimeout does: refuse to run with any `this` but the global one.
    function strict(this: unknown, fn: () => void, ms?: number) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      return real(fn, ms);
    }
    vi.stubGlobal("setTimeout", strict);
    const m = await mount({ systemClock: true, init: { "endue.docker.stats-interval": 1 } });
    await new Promise((resolve) => real(resolve, 30));
    await m.settle();
    expect(m.view.said).not.toContain("Illegal invocation");
    expect(m.docker.of("stats").length).toBeGreaterThan(0);
    await m.app.stop();
  });
});
