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

  it("names a letter by its key when Alt is held, as macOS's Option composes another character", () => {
    expect(comboOf({ ...key("∂", { meta: true, alt: true }), code: "KeyD" })).toBe("Meta+Alt+D");
    expect(comboOf({ ...key("¡", { alt: true }), code: "Digit1" })).toBe("Alt+1");
    expect(comboOf({ ...key("é", {}), code: "KeyE" })).toBe("É");
  });

  it("names a shifted punctuation key by its unshifted key", () => {
    // What a plugin frame forwards for Control+Shift+/ (and WebKit reports for Command+Shift+/).
    expect(comboOf(key("?", { ctrl: true, shift: true }))).toBe("Control+Shift+/");
    expect(comboOf(key("?", { meta: true, shift: true }))).toBe("Meta+Shift+/");
    expect(comboOf(key(">", { meta: true, shift: true }))).toBe("Meta+Shift+.");
    // A key that is the same either way, and ? without Shift (another layout), stay as they are.
    expect(comboOf(key("/", { meta: true, shift: true }))).toBe("Meta+Shift+/");
    expect(comboOf(key("?", { meta: true }))).toBe("Meta+?");
    const router = new ShortcutRouter({ platform: "mac" });
    let hits = 0;
    router.bind("Mod+Shift+/", () => {
      hits += 1;
    });
    expect(router.handle(key("?", { meta: true, shift: true }))).toBe(true);
    expect(hits).toBe(1);
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

  it("hands the next key to a capture instead of its binding, once", () => {
    const router = new ShortcutRouter({ platform: "mac" });
    const hits: string[] = [];
    router.bind("Mod+S", () => hits.push("save"));
    const captured: string[] = [];
    router.captureNext((combo) => captured.push(combo));
    expect(router.handle(key("Shift"))).toBe(false);
    expect(router.handle(key("s", { meta: true }))).toBe(true);
    expect(router.handle(key("s", { meta: true }))).toBe(true);
    expect(captured).toEqual(["Meta+S"]);
    expect(hits).toEqual(["save"]);
    const cancel = router.captureNext((combo) => captured.push(combo));
    cancel();
    router.handle(key("s", { meta: true }));
    expect(captured).toEqual(["Meta+S"]);
  });

  it("unbinds", () => {
    const router = new ShortcutRouter({ platform: "other" });
    const off = router.bind("Escape", () => {});
    off();
    expect(router.handle(key("Escape"))).toBe(false);
  });
});
