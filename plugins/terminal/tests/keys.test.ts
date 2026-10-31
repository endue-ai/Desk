import { describe, expect, it } from "vitest";
import { canonical, comboOf, DESK_KEYS, decide, type KeyPress } from "../ui/keys.js";
import type { Platform } from "../ui/shell.js";

const press = (
  key: string,
  mods: Partial<Pick<KeyPress, "metaKey" | "ctrlKey" | "altKey" | "shiftKey">> = {},
): KeyPress => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

const on = (
  platform: Platform,
  key: KeyPress,
  extra: { deskKeys?: string[]; hasSelection?: boolean } = {},
) => decide(key, { platform, ...extra });

describe("combos", () => {
  it("name a press as the runtime's keymap does", () => {
    expect(comboOf(press("k", { metaKey: true }))).toBe("Meta+K");
    expect(comboOf(press("Tab", { ctrlKey: true, shiftKey: true }))).toBe("Control+Shift+Tab");
    expect(comboOf(press("`", { ctrlKey: true }))).toBe("Control+`");
    expect(comboOf(press("Escape"))).toBe("Escape");
  });

  it("read Mod, Ctrl, Cmd and Option the way people write them", () => {
    expect(canonical("Mod+K", "mac")).toBe("Meta+K");
    expect(canonical("Mod+K", "linux")).toBe("Control+K");
    expect(canonical("Ctrl+Shift+Tab", "mac")).toBe("Control+Shift+Tab");
    expect(canonical("Cmd+Option+D", "mac")).toBe("Meta+Alt+D");
    expect(canonical("Control+`", "windows")).toBe("Control+`");
    expect(canonical("Shift+Mod++", "linux")).toBe("Control+Shift++");
  });
});

describe("who gets a key pressed in a terminal", () => {
  it("the shell gets Escape, letters and Control chords, on every platform", () => {
    for (const platform of ["mac", "linux", "windows"] as const) {
      expect(on(platform, press("Escape"))).toBe("terminal");
      expect(on(platform, press("a"))).toBe("terminal");
      expect(on(platform, press("c", { ctrlKey: true }))).toBe("terminal");
      expect(on(platform, press("r", { ctrlKey: true }))).toBe("terminal");
      expect(on(platform, press("ArrowUp"))).toBe("terminal");
      expect(on(platform, press("d", { altKey: true }))).toBe("terminal");
    }
  });

  it("the desk gets its own chords: the palette, buffers, windows and desktops", () => {
    expect(on("mac", press("k", { metaKey: true }))).toBe("desk");
    expect(on("linux", press("k", { ctrlKey: true }))).toBe("desk");
    expect(on("mac", press("k", { ctrlKey: true }))).toBe("terminal");
    expect(on("mac", press("`", { ctrlKey: true }))).toBe("desk");
    expect(on("windows", press("`", { ctrlKey: true }))).toBe("desk");
    expect(on("linux", press("Tab", { ctrlKey: true }))).toBe("desk");
    expect(on("linux", press("1", { ctrlKey: true }))).toBe("desk");
    expect(on("linux", press("T", { ctrlKey: true, shiftKey: true }))).toBe("desk");
    expect(on("linux", press("d", { ctrlKey: true, altKey: true }))).toBe("desk");
    expect(on("mac", press("w", { metaKey: true }))).toBe("desk");
  });

  it("on macOS every other Command chord goes to the desk too", () => {
    expect(on("mac", press("q", { metaKey: true }))).toBe("desk");
    expect(on("mac", press("c", { metaKey: true, shiftKey: true }))).toBe("desk");
  });

  it("the clipboard gets copy over a selection and paste, as each platform spells them", () => {
    expect(on("mac", press("c", { metaKey: true }), { hasSelection: true })).toBe("copy");
    expect(on("mac", press("c", { metaKey: true }))).toBe("desk");
    expect(on("mac", press("v", { metaKey: true }))).toBe("paste");
    expect(on("linux", press("C", { ctrlKey: true, shiftKey: true }))).toBe("copy");
    expect(on("linux", press("V", { ctrlKey: true, shiftKey: true }))).toBe("paste");
    expect(on("windows", press("c", { ctrlKey: true }), { hasSelection: true })).toBe("copy");
    expect(on("windows", press("c", { ctrlKey: true }))).toBe("terminal");
    expect(on("windows", press("v", { ctrlKey: true }))).toBe("paste");
    expect(on("linux", press("c", { ctrlKey: true, altKey: true }), { hasSelection: true })).toBe(
      "terminal",
    );
  });

  it("the settings add chords for the desk", () => {
    expect(on("linux", press("q", { ctrlKey: true }))).toBe("terminal");
    expect(on("linux", press("q", { ctrlKey: true }), { deskKeys: ["Ctrl+Q"] })).toBe("desk");
    expect(on("mac", press("q", { ctrlKey: true }), { deskKeys: ["Mod+Q"] })).toBe("terminal");
    expect(on("mac", press("q", { metaKey: true }), { deskKeys: ["Mod+Q"] })).toBe("desk");
  });

  it("lists the desk's keys as desk.keys binds them", () => {
    for (const chord of ["Mod+K", "Mod+B", "Mod+W", "Control+Tab", "Control+1", "Mod+Shift+T"]) {
      expect(DESK_KEYS).toContain(chord);
    }
  });
});
