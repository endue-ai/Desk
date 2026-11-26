import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import manifest from "../plugin.json";

const commands = (manifest as PluginManifest).contributes?.commands ?? [];

describe("agents' tools", () => {
  it("declares what agents can read or act on before the plugin opens (ADR 0088)", () => {
    const flags = (id: string) => {
      const r = commands.find((c) => c.id === id);
      return [r?.agent ?? false, r?.readOnly ?? false];
    };
    expect(flags("endue.docker.containers")).toEqual([true, true]);
    expect(flags("endue.docker.inspect")).toEqual([true, true]);
    expect(flags("endue.docker.stop")).toEqual([true, false]);
    expect(flags("endue.docker.prune")).toEqual([true, false]);
    expect(flags("endue.docker.open")).toEqual([false, false]);
    for (const name of ["view", "files"]) {
      expect(flags(`endue.docker.${name}`), name).toEqual([true, true]);
    }
    for (const name of ["filter", "sort", "context", "cancel", "shell", "open-port", "open-file"]) {
      expect(flags(`endue.docker.${name}`), name).toEqual([true, false]);
    }
    const asks = commands.filter((c) => c.description?.endsWith("Asks first."));
    expect(asks.length).toBeGreaterThan(0);
    expect(asks.every((c) => c.irreversible && c.agent && !c.readOnly)).toBe(true);
    // Running an image runs its code: an agent's run waits for the person every time.
    expect(commands.find((c) => c.id === "endue.docker.run")?.irreversible).toBe(true);
  });
});
