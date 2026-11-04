import { describe, expect, it } from "vitest";
import { COMMANDS } from "../ui/schemas.js";
import { ACTS, READS } from "../ui/tools.js";
import { mount } from "./harness";

describe("agents' tools", () => {
  it("offers agents what reads the engine and what acts on it, never a surface (ADR 0084)", async () => {
    const m = await mount();
    const registered = m.params("cmd.register") as Array<{
      id: string;
      agent?: boolean;
      readOnly?: boolean;
    }>;
    const flags = (id: string) => {
      const r = registered.find((c) => c.id === id);
      return [r?.agent ?? false, r?.readOnly ?? false];
    };
    expect(flags("endue.docker.containers")).toEqual([true, true]);
    expect(flags("endue.docker.inspect")).toEqual([true, true]);
    expect(flags("endue.docker.stop")).toEqual([true, false]);
    expect(flags("endue.docker.prune")).toEqual([true, false]);
    expect(flags("endue.docker.open")).toEqual([false, false]);
    expect(flags("endue.docker.shell")).toEqual([false, false]);
    const ids = new Set(COMMANDS.map((c) => c.id));
    for (const id of [...READS, ...ACTS]) expect(ids.has(id), id).toBe(true);
    // What cannot be taken back is irreversible, so an agent's call waits for the person.
    const asks = COMMANDS.filter((c) => c.description.endsWith("Asks first."));
    expect(asks.every((c) => c.irreversible && ACTS.has(c.id))).toBe(true);
    // Running an image runs its code: an agent's run waits for the person every time.
    expect(COMMANDS.find((c) => c.id === "endue.docker.run")?.irreversible).toBe(true);
  });
});
