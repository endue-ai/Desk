import { BridgeClient, type BridgeEvent, browserStub, stubCommands } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { Commands } from "./commands";
import { canonical, formatCombo, ShortcutRouter } from "./input";
import { Keymap, resolveKeymap } from "./keymap";

const press = (key: string, mods: { meta?: boolean; ctrl?: boolean; shift?: boolean } = {}) => ({
  key,
  metaKey: mods.meta ?? false,
  ctrlKey: mods.ctrl ?? false,
  altKey: false,
  shiftKey: mods.shift ?? false,
});

describe("canonical and formatCombo", () => {
  it("name keys the same way on every platform and read them the platform's way", () => {
    expect(canonical("Mod+Shift+p", "mac")).toBe("Meta+Shift+P");
    expect(canonical("Mod+Shift+p", "other")).toBe("Control+Shift+P");
    expect(canonical("Ctrl+Alt+ArrowLeft", "mac")).toBe("Control+Alt+ArrowLeft");
    expect(canonical("Mod++", "other")).toBe("Control++");
    expect(formatCombo("Meta+Shift+P", "mac")).toBe("⇧⌘P");
    expect(formatCombo("Control+Shift+P", "other")).toBe("Ctrl+Shift+P");
    expect(formatCombo("Control++", "other")).toBe("Ctrl++");
  });
});

describe("resolveKeymap", () => {
  it("lets a later layer rebind a key or take it away, and uses mac keys on macOS", () => {
    const keys = [
      { key: "Mod+W", command: "desk.buffers.close", owner: "desk.keys" },
      { key: "Mod+K", command: "desk.palette.open", owner: "desk.keys" },
      { key: "Mod+J", mac: "Meta+Alt+J", command: "example.notes.jump", owner: "example.notes" },
      { key: "Mod+W", command: "", owner: "example.notes" },
      { key: "Mod+K", command: "example.notes.find", args: { all: true }, owner: "example.notes" },
    ];
    expect(resolveKeymap(keys, "other")).toEqual([
      { combo: "Control+J", command: "example.notes.jump", owner: "example.notes" },
      {
        combo: "Control+K",
        command: "example.notes.find",
        args: { all: true },
        owner: "example.notes",
      },
    ]);
    expect(resolveKeymap(keys, "mac").map((b) => b.combo)).toEqual(["Meta+Alt+J", "Meta+K"]);
  });
});

describe("Keymap", () => {
  it("runs the bound command and lets keys of commands that are off pass on", async () => {
    const router = new ShortcutRouter({ platform: "mac" });
    const registry = stubCommands((event: BridgeEvent) => stub.emit(event));
    const stub = browserStub({ ...registry.handlers });
    const commands = new Commands(new BridgeClient(stub));
    const ran: unknown[] = [];
    commands.define("desk.palette.open", {
      title: "Open",
      owner: "desk.palette",
      run: (args) => ran.push(args),
    });
    const keymap = new Keymap(router, commands);
    keymap.apply([
      { key: "Mod+K", command: "desk.palette.open", args: { n: 1 }, owner: "desk.keys" },
    ]);
    await commands.settled();
    expect(router.handle(press("k", { meta: true }))).toBe(false);
    commands.setActive(["desk.palette"]);
    await commands.settled();
    expect(router.handle(press("k", { meta: true }))).toBe(true);
    await expect.poll(() => ran).toEqual([{ n: 1 }]);
    expect(keymap.keysFor("desk.palette.open")).toEqual(["⌘K"]);
    keymap.apply([]);
    expect(router.handle(press("k", { meta: true }))).toBe(false);
  });
});
