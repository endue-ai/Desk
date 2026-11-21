import { describe, expect, it, vi } from "vitest";
import type { ShellCtx } from "../shell/context";
import { emptyState, Store } from "../shell/state";
import { defineSummon, SUMMON } from "./summon";

describe("desk.eris.summon", () => {
  it("opens the talk line, and closes an open line only for a toggle", async () => {
    const store = new Store(emptyState("en"));
    const run = vi.fn(async (_id: string) => {});
    const off = vi.fn();
    const define = vi.fn((_id: string, _spec: { run(args: unknown): unknown }) => off);
    const ctx = { store, runtime: { commands: { define, run } } } as unknown as ShellCtx;
    const stop = defineSummon(ctx);
    const registration = define.mock.calls[0];
    if (!registration) throw new Error("desk.eris.summon was not registered");
    const [id, summon] = registration;
    expect(id).toBe(SUMMON);

    await summon.run({ toggle: true });
    expect(run.mock.calls).toEqual([["desk.shell.talk"]]);

    store.set({ composer: { open: true, text: "half", selected: 0 } });
    await summon.run({ toggle: true });
    expect(store.get().composer).toEqual({ open: false, text: "", selected: 0 });
    expect(run).toHaveBeenCalledTimes(1);

    store.set({ composer: { open: true, text: "", selected: 0 } });
    await summon.run({ toggle: false });
    expect(run.mock.calls).toEqual([["desk.shell.talk"], ["desk.shell.talk"]]);

    stop();
    expect(off).toHaveBeenCalledOnce();
  });
});
