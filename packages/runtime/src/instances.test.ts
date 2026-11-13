import type { PluginManifest } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import {
  instanceKey,
  instanceNumber,
  instanceSurface,
  PluginInstances,
  perFile,
  pluginOf,
} from "./instances";
import { surfaceHost } from "./plugin-origins";

describe("a window's key", () => {
  it("is the plugin id for the first window and <plugin>@<n> after, on a host of its own", () => {
    expect(instanceKey("endue.images", 1)).toBe("endue.images");
    expect(instanceKey("endue.images", 3)).toBe("endue.images@3");
    expect(pluginOf("endue.images@3")).toBe("endue.images");
    expect(instanceNumber("endue.images@3")).toBe(3);
    expect(instanceNumber("endue.images")).toBe(1);
    expect(surfaceHost("endue.images", instanceSurface("main", 3))).toBe("main--3.endue-images");
    expect(surfaceHost("endue.images", instanceSurface("main", 1))).toBe("main.endue-images");
  });

  it("leaves any other surface's id whole, an agent's view with an @ in it too", () => {
    for (const id of ["endue-agent:ana@home", "agent:x@2", "keys", "endue.images@x", "a@2"]) {
      expect(pluginOf(id)).toBe(id);
      expect(instanceNumber(id)).toBe(1);
    }
  });

  it("says which openers open a window per file", () => {
    const manifest = (instances?: "one" | "per-file"): PluginManifest => ({
      id: "example.viewer",
      version: "0.1.0",
      kind: "ui",
      surfaces: [{ id: "main", placement: "center", ...(instances ? { instances } : {}) }],
    });
    expect(perFile(manifest("per-file"))).toBe(true);
    expect(perFile(manifest("one"))).toBe(false);
    expect(perFile(manifest())).toBe(false);
    expect(perFile(undefined)).toBe(false);
  });
});

describe("PluginInstances", () => {
  it("mints the first window's key while it is closed, else a number never used before", () => {
    const open = new PluginInstances();
    expect(open.mint("endue.images")).toBe("endue.images");
    open.add("endue.images");
    expect(open.mint("endue.images")).toBe("endue.images@2");
    open.add("endue.images@2");
    open.add("endue.images@3");
    open.delete("endue.images@3");
    // A host is never used twice in a session: its page is the window's own.
    expect(open.mint("endue.images")).toBe("endue.images@4");
    open.delete("endue.images");
    expect(open.mint("endue.images")).toBe("endue.images");
    expect(open.of("endue.images")).toEqual(["endue.images@2"]);
  });

  it("knows a plugin's window in use: the last touched, else the last opened", () => {
    const open = new PluginInstances();
    for (const key of ["endue.notes", "endue.notes@2", "endue.notes@3", "endue.data"])
      open.add(key);
    expect(open.inUse("endue.notes")).toBe("endue.notes@3");
    open.touch("endue.notes");
    expect(open.inUse("endue.notes")).toBe("endue.notes");
    expect(open.resolve("endue.notes@2")).toBe("endue.notes@2");
    expect(open.resolve("endue.notes")).toBe("endue.notes");
    open.delete("endue.notes");
    // A plugin id whose first window closed resolves to the window in use.
    expect(open.resolve("endue.notes")).toBe("endue.notes@3");
    expect(open.resolve("endue.none")).toBeUndefined();
  });

  it("sends a command run's answer to the window that ran it", () => {
    const open = new PluginInstances();
    open.add("endue.images");
    open.add("endue.images@2");
    open.ran("inv-1", "endue.images");
    open.touch("endue.images@2");
    expect(open.answered("inv-1", "endue.images")).toBe("endue.images");
    // An answer that came before its run was known goes to the window in use.
    expect(open.answered("inv-2", "endue.images")).toBe("endue.images@2");
  });
});
