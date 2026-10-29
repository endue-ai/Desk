import { describe, expect, it } from "vitest";
import { commandAt, isDefault, type KeyLayers, keysOf, rebind, reset, unbind } from "./rebind";

const contributed = [
  { key: "Mod+N", command: "desk.display.new-surface", owner: "desk.keys" },
  { key: "Mod+D", command: "desk.display.split-right", owner: "desk.keys" },
  { key: "Control+2", command: "desk.shell.desktop-2", owner: "desk.keys" },
  { key: "Mod+]", command: "desk.display.focus-next", owner: "desk.keys" },
  { key: "Control+Tab", command: "desk.display.focus-next", owner: "desk.keys" },
];
const layers = (personal: KeyLayers["personal"] = []): KeyLayers => ({
  contributed,
  personal,
  platform: "mac",
});

describe("rebind", () => {
  it("gives a command one key and takes its old keys away", () => {
    const { personal, displaced } = rebind(layers(), "desk.display.focus-next", "Mod+Shift+N");
    expect(displaced).toBeUndefined();
    const after = layers(personal);
    expect(keysOf(after, "desk.display.focus-next")).toEqual(["Meta+Shift+N"]);
    expect(commandAt(after, "Meta+]")).toBeUndefined();
    expect(commandAt(after, "Control+Tab")).toBeUndefined();
    expect(isDefault(after, "desk.display.focus-next")).toBe(false);
  });

  it("moves a key another command had, and says which", () => {
    const { personal, displaced } = rebind(layers(), "desk.shell.desktop-2", "Mod+D");
    expect(displaced).toBe("desk.display.split-right");
    const after = layers(personal);
    expect(keysOf(after, "desk.shell.desktop-2")).toEqual(["Meta+D"]);
    expect(keysOf(after, "desk.display.split-right")).toEqual([]);
    expect(commandAt(after, "Control+2")).toBeUndefined();
  });

  it("reads keys the way the platform names them", () => {
    const { personal } = rebind(layers(), "desk.display.new-surface", "Meta+Shift+n");
    expect(personal).toContainEqual({ key: "Meta+Shift+N", command: "desk.display.new-surface" });
    expect(keysOf(layers(personal), "desk.display.new-surface")).toEqual(["Meta+Shift+N"]);
  });
});

describe("unbind and reset", () => {
  it("unbinds every key of a command", () => {
    const after = layers(unbind(layers(), "desk.display.focus-next"));
    expect(keysOf(after, "desk.display.focus-next")).toEqual([]);
  });

  it("gives a command its plugins' keys back, from whoever took them", () => {
    const moved = layers(rebind(layers(), "desk.shell.desktop-2", "Mod+D").personal);
    const back = layers(reset(moved, "desk.display.split-right"));
    expect(keysOf(back, "desk.display.split-right")).toEqual(["Meta+D"]);
    expect(keysOf(back, "desk.shell.desktop-2")).toEqual([]);
    const all = layers(reset(back, "desk.shell.desktop-2"));
    expect(all.personal).toEqual([]);
    expect(isDefault(all, "desk.shell.desktop-2")).toBe(true);
  });
});
