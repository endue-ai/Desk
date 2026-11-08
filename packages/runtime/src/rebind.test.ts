import { describe, expect, it } from "vitest";
import {
  checkRebind,
  commandAt,
  isDefault,
  type KeyLayers,
  keysOf,
  rebind,
  reset,
  unbind,
} from "./rebind";

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
  it("removes mac-specific personal bindings by their effective key", () => {
    const source = layers([
      { key: "Control+J", mac: "Meta+J", command: "desk.display.new-surface" },
    ]);
    const after = layers(rebind(source, "desk.display.new-surface", "Meta+E").personal);
    expect(keysOf(after, "desk.display.new-surface")).toEqual(["Meta+E"]);
    expect(commandAt(after, "Meta+J")).toBeUndefined();
  });
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

describe("rebinding a key sequence (ADR 0118)", () => {
  const palette = [
    { key: "Mod+K", command: "desk.palette.open", owner: "desk" },
    { key: "Mod+J Mod+S", command: "example.notes.save-all", owner: "example.notes" },
  ];
  const seq = (personal: KeyLayers["personal"] = []): KeyLayers => ({
    contributed: palette,
    personal,
    platform: "mac",
  });

  it("asks before shadowing, both ways, and shows what would be shadowed", () => {
    // A longer key under a key that runs a command: that command would only wait.
    const longer = checkRebind(seq(), "desk.files.save", "Mod+K Mod+S");
    expect(longer.sequence).toBe("Meta+K Meta+S");
    expect(longer.shadows.map((b) => [b.combo, b.command])).toEqual([
      ["Meta+K", "desk.palette.open"],
    ]);
    // A shorter key over a sequence: the sequence could never be reached.
    const shorter = checkRebind(seq(), "desk.files.save", "Mod+J");
    expect(shorter.shadows.map((b) => b.combo)).toEqual(["Meta+J Meta+S"]);
    expect(checkRebind(seq(), "desk.files.save", "Mod+L").shadows).toEqual([]);
  });

  it("refuses a key that can never run and asks about one the system keeps", () => {
    expect(checkRebind(seq(), "desk.files.save", "Ctrl+X Escape").refused?.does).toBe(
      "cancels a pending prefix",
    );
    expect(checkRebind(seq(), "desk.files.save", "Mod+Q").reserved?.by).toBe("macOS");
    expect(checkRebind(seq(), "desk.files.save", "Mod+Q").refused).toBeUndefined();
  });

  it("takes the shadowed keys away once confirmed, so nothing is left in conflict", () => {
    const { personal, shadowed } = rebind(seq(), "desk.files.save", "Mod+K Mod+S");
    expect(shadowed).toEqual(["desk.palette.open"]);
    expect(personal).toEqual([
      { key: "Meta+K", command: "" },
      { key: "Meta+K Meta+S", command: "desk.files.save" },
    ]);
    const after = seq(personal);
    expect(keysOf(after, "desk.files.save")).toEqual(["Meta+K Meta+S"]);
    expect(commandAt(after, "Meta+K")).toBeUndefined();
    // Reset gives the palette Mod+K back, taking the sequence under it from whoever had it.
    const back = seq(reset(after, "desk.palette.open"));
    expect(keysOf(back, "desk.palette.open")).toEqual(["Meta+K"]);
    expect(keysOf(back, "desk.files.save")).toEqual([]);
  });
});
