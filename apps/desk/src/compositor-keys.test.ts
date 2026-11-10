import { describe, expect, it } from "vitest";
import { type KeyEntry, type KeysReport, keysReport, startCompositorKeys } from "./compositor-keys";

function source(entries: KeyEntry[]) {
  const listeners = { keymap: new Set<() => void>(), commands: new Set<() => void>() };
  const settingsListeners = new Set<(keys: string[]) => void>();
  const settings = new Map<string, unknown>();
  let ids = ["desk.palette.open"];
  const on =
    <T>(set: Set<T>) =>
    (listener: T) => {
      set.add(listener);
      return () => set.delete(listener);
    };
  return {
    platform: "mac" as const,
    keymap: { entries: () => entries, onChange: on(listeners.keymap) },
    commands: { list: () => ids.map((id) => ({ id })), onChange: on(listeners.commands) },
    settings: {
      get: <T>(key: string, fallback: T) =>
        settings.has(key) ? (settings.get(key) as T) : fallback,
      onChange: on(settingsListeners),
    },
    rebind(next: KeyEntry[]) {
      entries = next;
      for (const listener of listeners.keymap) listener();
    },
    register(next: string[]) {
      ids = next;
      for (const listener of listeners.commands) listener();
    },
    set(key: string, value: unknown) {
      settings.set(key, value);
      for (const listener of settingsListeners) listener([key]);
    },
  };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("the keymap report (#56)", () => {
  it("hands the compositor every layer's entries, the commands registered and the prefix's wait", () => {
    const entries = [
      { key: "Mod+K", command: "desk.palette.open", owner: "desk" },
      {
        key: "Mod+K Mod+S",
        command: "example.notes.save-all",
        owner: "example.notes",
        args: { all: true },
      },
    ];
    expect(keysReport(source(entries))).toEqual({
      platform: "mac",
      entries,
      known: ["desk.palette.open"],
      timeout: 0,
    });
  });

  it("says it again once per change, and never twice the same", async () => {
    const s = source([{ key: "Mod+K", command: "desk.palette.open", owner: "desk" }]);
    const sent: KeysReport[] = [];
    const stop = startCompositorKeys(s, (report) => sent.push(report));
    await tick();
    expect(sent).toHaveLength(1);
    s.rebind([{ key: "Mod+J", command: "desk.palette.open", owner: "person" }]);
    s.register(["desk.palette.open", "example.notes.save-all"]);
    await tick();
    expect(sent).toHaveLength(2);
    expect(sent[1]?.entries[0]?.key).toBe("Mod+J");
    expect(sent[1]?.known).toEqual(["desk.palette.open", "example.notes.save-all"]);
    s.set("desk.keys.sequence-timeout", 1500);
    await tick();
    expect(sent.at(-1)?.timeout).toBe(1500);
    s.register(["desk.palette.open", "example.notes.save-all"]);
    await tick();
    expect(sent).toHaveLength(3);
    stop();
    s.rebind([]);
    await tick();
    expect(sent).toHaveLength(3);
  });
});
