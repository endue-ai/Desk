import { describe, expect, it } from "vitest";
import { AGAIN_MS, CrashRecovery } from "./recovery";

describe("CrashRecovery", () => {
  it("reloads a first death, holds a second within a minute, and reloads one a minute later", () => {
    let now = 1000;
    const recovery = new CrashRecovery(() => now);
    expect(recovery.crashed("a.one")).toBe("reload");
    now += AGAIN_MS - 1;
    expect(recovery.crashed("a.one")).toBe("hold");
    expect(recovery.held("a.one")).toBe(true);
    // Held for the run: a later death keeps it held.
    now += AGAIN_MS * 5;
    expect(recovery.crashed("a.one")).toBe("hold");
    // Another plugin is its own.
    expect(recovery.crashed("b.two")).toBe("reload");
    now += AGAIN_MS;
    expect(recovery.crashed("b.two")).toBe("reload");
  });

  it("a reload by the person gives the plugin its automatic reload back", () => {
    let now = 0;
    const recovery = new CrashRecovery(() => now);
    recovery.crashed("a.one");
    now += 10;
    expect(recovery.crashed("a.one")).toBe("hold");
    recovery.released("a.one");
    expect(recovery.held("a.one")).toBe(false);
    now += 10;
    expect(recovery.crashed("a.one")).toBe("reload");
  });
});
