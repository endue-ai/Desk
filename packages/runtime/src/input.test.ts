import { describe, expect, it } from "vitest";
import { comboOf, ShortcutRouter } from "./input";

const key = (
  k: string,
  mods: Partial<Record<"meta" | "ctrl" | "alt" | "shift", boolean>> = {},
) => ({
  key: k,
  metaKey: mods.meta ?? false,
  ctrlKey: mods.ctrl ?? false,
  altKey: mods.alt ?? false,
  shiftKey: mods.shift ?? false,
});

describe("comboOf", () => {
  it("names keys with modifiers in a fixed order", () => {
    expect(comboOf(key("k", { meta: true, shift: true }))).toBe("Meta+Shift+K");
    expect(comboOf(key("Escape"))).toBe("Escape");
  });
});

describe("ShortcutRouter", () => {
  it("maps Mod to Meta on macOS and to Control elsewhere", () => {
    const mac = new ShortcutRouter({ platform: "mac" });
    const other = new ShortcutRouter({ platform: "other" });
    const hits: string[] = [];
    mac.bind("Mod+K", () => hits.push("mac"));
    other.bind("Mod+K", () => hits.push("other"));
    expect(mac.handle(key("k", { meta: true }))).toBe(true);
    expect(other.handle(key("k", { ctrl: true }))).toBe(true);
    expect(mac.handle(key("k", { ctrl: true }))).toBe(false);
    expect(hits).toEqual(["mac", "other"]);
  });

  it("routes to the focused surface before the global keymap", () => {
    const router = new ShortcutRouter({ platform: "other" });
    const hits: string[] = [];
    router.bind("Mod+K", () => hits.push("global"));
    router.bind("Mod+K", () => hits.push("notes"), { surface: "notes" });
    router.handle(key("k", { ctrl: true }));
    router.focus("notes");
    router.handle(key("k", { ctrl: true }));
    router.focus("terminal");
    router.handle(key("k", { ctrl: true }));
    expect(hits).toEqual(["global", "notes", "global"]);
  });

  it("lets keys without a binding pass through", () => {
    const router = new ShortcutRouter({ platform: "other" });
    router.bind("Mod+K", () => {});
    expect(router.handle(key("j", { ctrl: true }))).toBe(false);
    expect(router.handle(key("k"))).toBe(false);
  });

  it("unbinds", () => {
    const router = new ShortcutRouter({ platform: "other" });
    const off = router.bind("Escape", () => {});
    off();
    expect(router.handle(key("Escape"))).toBe(false);
  });
});
