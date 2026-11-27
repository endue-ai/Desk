// A feature registers its commands, actions and panels (ui/features/README.md): its command answers
// through the same failure and cancel handling as the built-in ones, its actions sit beside the
// view's built-in actions under the same guard, and nothing is claimed twice.
import { describe, expect, it } from "vitest";
import { createDatabase } from "../ui/database.js";
import type { Feature } from "../ui/feature-host.js";
import * as builtins from "../ui/features/index.js";
import { fakeFeature } from "./fake-feature";
import { type Mounted, mount, recordingView, SAVED } from "./harness";
import { inProcessOutput } from "./output";

const features = (): Feature[] => [...Object.values(builtins), fakeFeature()];
const acts = (m: Mounted) =>
  m.app as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;

describe("a feature's commands", () => {
  it("answers a feature's command through the built-in failure and cancel handling", async () => {
    const m = await mount({ store: { connections: SAVED }, features: features() });
    await expect(m.host.command("endue.database.fake-open", { connection: "Notes" })).resolves.toBe(
      "Counting on Notes",
    );
    expect(m.shown()).toMatchObject({ kind: "fake", name: "count: Notes", fake: { n: 1 } });
    await expect(m.host.command("endue.database.fake-fail")).rejects.toThrow(
      "The fake command failed.",
    );
    expect(m.view.said.at(-1)).toBe("The fake command failed.");
    const said = m.view.said.length;
    await expect(m.host.command("endue.database.fake-cancel")).rejects.toThrow();
    expect(m.view.said).toHaveLength(said);
  });
});

describe("a feature's actions", () => {
  it("merges a feature's actions into the view's actions, guarded", async () => {
    const m = await mount({ store: { connections: SAVED }, features: features() });
    await m.host.command("endue.database.fake-open", { connection: "Notes", n: 2 });
    await expect(acts(m).fakeBump?.(3)).resolves.toBe(5);
    await m.settle();
    expect(m.shown()?.fake).toEqual({ n: 5 });
    await expect(acts(m).fakeFail?.()).resolves.toBeUndefined();
    expect(m.view.said.at(-1)).toBe("The fake action failed.");
    // The built-in actions and the ER diagram's stay where the view finds them, by name.
    expect(typeof acts(m).runAll).toBe("function");
    expect(typeof acts(m).diagram).toBe("function");
  });
});

describe("claims", () => {
  const ctx = () =>
    ({
      bridge: { call: async () => ({}), onEvent: () => () => {} },
      commands: { on: () => {}, run: async () => undefined },
      state: { get: () => undefined, set: () => {} },
    }) as unknown as Parameters<typeof createDatabase>[0];
  const start = (list: Feature[]) => () =>
    createDatabase(ctx(), recordingView(), { output: inProcessOutput, features: list });
  const panel = fakeFeature().panels?.fake;
  if (!panel) throw new Error("the fake feature has a panel");
  const twin = (patch: Partial<Feature>): Feature => ({ id: "twin", ...patch });

  it("refuses a command, action or panel type claimed twice, and a panel type that is a built-in kind", () => {
    const fake = fakeFeature();
    const opens = twin({ commands: () => ({ "endue.database.fake-open": () => 1 }) });
    expect(start([fake, opens])).toThrow(/endue\.database\.fake-open/u);
    const builtIn = twin({ commands: () => ({ "endue.database.run": () => 1 }) });
    expect(start([builtIn])).toThrow(/endue\.database\.run/u);
    expect(start([fake, twin({ actions: () => ({ fakeBump: () => 1 }) })])).toThrow(/fakeBump/u);
    expect(start([twin({ actions: () => ({ runAll: () => 1 }) })])).toThrow(/runAll/u);
    expect(start([fake, twin({ panels: { fake: panel } })])).toThrow(/fake/u);
    expect(start([twin({ panels: { table: panel } })])).toThrow(/table/u);
    expect(start([twin({ panels: { text: panel } })])).toThrow(/text/u);
    expect(start([fake])).not.toThrow();
  });
});
