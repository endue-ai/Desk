import { describe, expect, test } from "vitest";
import { canonical, format, isChord, Keymap } from "./keys";

describe("key names", () => {
  test("Mod is ⌘ on macOS and Ctrl elsewhere; order and case are normalised", () => {
    expect(canonical("Mod+Shift+d", "mac")).toBe("Meta+Shift+D");
    expect(canonical("shift+Mod+d".replace("shift", "Shift"), "other")).toBe("Control+Shift+D");
    expect(canonical("Ctrl+1", "mac")).toBe("Control+1");
    expect(canonical("Escape", "mac")).toBe("Escape");
  });

  test("bindings read like the platform writes them", () => {
    expect(format("Meta+Shift+D", "mac")).toBe("⇧⌘D");
    expect(format("Control+1", "mac")).toBe("⌃1");
    expect(format("Control+Shift+D", "other")).toBe("Ctrl+Shift+D");
    expect(format("Escape", "mac")).toBe("Esc");
  });

  test("chords have ⌘, Ctrl or Alt; Shift alone does not make one", () => {
    expect(isChord("Meta+N")).toBe(true);
    expect(isChord("Shift+N")).toBe(false);
    expect(isChord("N")).toBe(false);
  });
});

describe("the keymap", () => {
  test("defaults: ⌘N opens a surface, ⌘D splits right, ⌃1 goes to desktop 1", () => {
    const keys = new Keymap("mac");
    expect(keys.commandFor("Meta+N")).toBe("window.new");
    expect(keys.commandFor("Meta+D")).toBe("pane.splitRight");
    expect(keys.commandFor("Control+1")).toBe("desktop.1");
    expect(keys.commandFor("Meta+Q")).toBeUndefined();
  });

  test("binding replaces the command's key and takes the key from whoever had it", () => {
    const keys = new Keymap("mac");
    let changes = 0;
    keys.onChange(() => changes++);
    expect(keys.bind("window.new", "Mod+Shift+N")).toBeUndefined();
    expect(keys.commandFor("Meta+N")).toBeUndefined();
    expect(keys.commandFor("Meta+Shift+N")).toBe("window.new");
    expect(keys.bind("mode.night", "Mod+D")).toBe("pane.splitRight");
    expect(keys.bindingsOf("pane.splitRight")).toEqual([]);
    expect(keys.commandFor("Meta+D")).toBe("mode.night");
    expect(changes).toBe(2);
  });

  test("reset brings the default back and takes its key back too", () => {
    const keys = new Keymap("mac");
    keys.bind("mode.night", "Mod+N");
    expect(keys.commandFor("Meta+N")).toBe("mode.night");
    keys.reset("window.new");
    expect(keys.commandFor("Meta+N")).toBe("window.new");
    expect(keys.bindingsOf("mode.night")).toEqual([]);
    expect(keys.isDefault("window.new")).toBe(true);
  });

  test("only overrides are saved, and loading ignores anything that is not a list of keys", () => {
    const keys = new Keymap("mac");
    keys.bind("window.new", "Mod+Shift+N");
    expect(keys.overrides()).toEqual({ "window.new": ["Meta+Shift+N"] });
    const again = new Keymap("mac");
    again.load({ "window.new": ["Mod+Shift+N"], broken: 3, "pane.close": [] });
    expect(again.commandFor("Meta+Shift+N")).toBe("window.new");
    expect(again.bindingsOf("pane.close")).toEqual([]);
    expect(again.bindingsOf("broken")).toEqual([]);
  });
});
