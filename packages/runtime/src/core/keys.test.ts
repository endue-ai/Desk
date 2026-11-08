import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonical } from "../input";
import { resolveKeymap } from "../keymap";
import { DEFAULT_KEYS as keys } from "./keys";

const PLUGINS = new URL("../../../../plugins/", import.meta.url);
/** Every key the built-in plugins contribute, as their plugin.json writes it. */
const pluginKeys = readdirSync(PLUGINS).flatMap((name) => {
  try {
    const manifest = JSON.parse(readFileSync(new URL(`${name}/plugin.json`, PLUGINS), "utf8"));
    return (manifest.contributes?.keys ?? []) as Array<{ key: string; mac?: string }>;
  } catch {
    return [];
  }
});

describe("the default keymap", () => {
  it("binds each key once, to a desk.* command", () => {
    const combos = keys.map((key) => key.key);
    expect(new Set(combos).size).toBe(combos.length);
    for (const key of keys) expect(key.command).toMatch(/^desk\.[a-z]+\.[a-z0-9-]+$/);
  });

  it("gives the shell's panes and desktops keys that clash with no policy's", () => {
    const map = new Map(resolveKeymap(keys, "mac").map((b) => [b.combo, b.command]));
    expect(map.get("Meta+D")).toBe("desk.display.split-right");
    expect(map.get("Meta+Alt+D")).toBe("desk.display.split-down");
    expect(map.get("Meta+Shift+D")).toBe("desk.notify.dnd");
    expect(map.get("Meta+W")).toBe("desk.buffers.close");
    expect(map.get("Meta+]")).toBe("desk.display.focus-next");
    expect(map.get("Control+2")).toBe("desk.shell.desktop-2");
  });

  it("binds Mod+Shift+/ to desk.describe.open", () => {
    for (const [platform, combo] of [
      ["mac", "Meta+Shift+/"],
      ["other", "Control+Shift+/"],
    ] as const) {
      const map = new Map(resolveKeymap(keys, platform).map((b) => [b.combo, b.command]));
      expect(map.get(combo)).toBe("desk.describe.open");
    }
  });

  it("opens the palette with Mod+K and quits with Escape, on every platform", () => {
    for (const [platform, combo] of [
      ["mac", "Meta+K"],
      ["other", "Control+K"],
    ] as const) {
      const map = new Map(resolveKeymap(keys, platform).map((b) => [b.combo, b.command]));
      expect(map.get(combo)).toBe("desk.palette.open");
      expect(map.get("Escape")).toBe("desk.keys.quit");
    }
  });

  it("arranges windows with Mod+Alt+G, C, S and Z, which no other default or plugin binds", () => {
    const arrange = {
      G: "desk.windows.tile",
      C: "desk.windows.cascade",
      S: "desk.windows.spread",
      Z: "desk.windows.restore-arrangement",
    };
    expect(pluginKeys.length).toBeGreaterThan(0);
    for (const platform of ["mac", "other"] as const) {
      const mod = platform === "mac" ? "Meta" : "Control";
      const map = new Map(resolveKeymap(keys, platform).map((b) => [b.combo, b.command]));
      const taken = pluginKeys.map((k) =>
        canonical(platform === "mac" && k.mac ? k.mac : k.key, platform),
      );
      for (const [letter, command] of Object.entries(arrange)) {
        const combo = `${mod}+Alt+${letter}`;
        expect(map.get(combo)).toBe(command);
        expect(keys.filter((k) => canonical(k.key, platform) === combo)).toHaveLength(1);
        expect(taken).not.toContain(combo);
      }
    }
  });
});
