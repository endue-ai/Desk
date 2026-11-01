import { describe, expect, it } from "vitest";
import { resolveKeymap } from "../keymap";
import { DEFAULT_KEYS as keys } from "./keys";

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
});
