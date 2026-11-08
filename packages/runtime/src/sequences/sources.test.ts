import type { PluginInfo } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { resolveBindings } from "./conflicts";
import { lintLines } from "./report";
import { bindingLines, personalSources, withSources } from "./sources";

const text = [
  "# Your key bindings",
  "bindings:",
  "  - key: Ctrl+X Ctrl+F",
  "    command: desk.files.open",
  "  # a prefix of my own",
  "  - key: Mod+K",
  "    command: desk.theme.toggle",
  "",
].join("\n");

const notes = {
  id: "example.notes",
  folder: "/desk/plugins/notes",
  manifest: { id: "example.notes", version: "0.1.0", kind: "ui" },
} as unknown as PluginInfo;

describe("where a binding is written", () => {
  it("finds the line of each binding in keys.yaml", () => {
    expect(bindingLines(text)).toEqual([3, 6]);
    expect(bindingLines("bindings: []\n")).toEqual([]);
    expect(bindingLines("bindings: [\n")).toEqual([]);
  });

  it("names keys.yaml's line, a manifest's contributes.keys index and the core default", () => {
    const entries = withSources(
      [{ key: "Mod+K", command: "desk.palette.open", owner: "desk" }],
      [
        { key: "Mod+N", command: "example.notes.new", owner: "example.notes" },
        { key: "Mod+K Mod+S", command: "example.notes.save-all", owner: "example.notes" },
        { key: "Mod+T", command: "example.todo.new", owner: "example.todo" },
      ],
      [
        { key: "Ctrl+X Ctrl+F", command: "desk.files.open" },
        { key: "Mod+K", command: "desk.theme.toggle" },
      ],
      {
        plugins: [notes],
        layer: "session",
        file: { file: "~/.desk/keys.yaml", lines: bindingLines(text) },
      },
    );
    expect(entries.map((e) => [e.owner, e.source])).toEqual([
      ["desk", { label: "core default" }],
      ["example.notes", { file: "/desk/plugins/notes/plugin.json", path: "contributes.keys[0]" }],
      ["example.notes", { file: "/desk/plugins/notes/plugin.json", path: "contributes.keys[1]" }],
      ["example.todo", { label: "plugin example.todo", path: "contributes.keys[0]" }],
      ["person", { file: "~/.desk/keys.yaml", line: 3 }],
      ["person", { file: "~/.desk/keys.yaml", line: 6 }],
    ]);
    const { conflicts } = resolveBindings(entries, "mac");
    expect(lintLines(conflicts, { platform: "mac" })).toEqual([
      "core default: info: ⌘K for desk.palette.open (core default) is replaced by desk.theme.toggle (~/.desk/keys.yaml:6)",
      "/desk/plugins/notes/plugin.json contributes.keys[1]: info: ⌘K ⌘S for example.notes.save-all (/desk/plugins/notes/plugin.json contributes.keys[1]) cannot be reached: ⌘K runs desk.theme.toggle (~/.desk/keys.yaml:6)",
    ]);
  });

  it("says the layer when the person's bindings come from init.yaml or a profile", () => {
    const [entry] = withSources([], [], [{ key: "Mod+J", command: "desk.keys.list" }], {
      plugins: [],
      layer: "init",
    });
    expect(entry?.source).toEqual({ label: "init.yaml desk.keys.bindings[0]" });
  });

  it("shares the person's file between desk.keys and its file, per settings", () => {
    const settings = {};
    const heard: unknown[] = [];
    personalSources(settings).onChange(() => heard.push(personalSources(settings).get()));
    personalSources(settings).set({ file: "~/.desk/keys.yaml", lines: [3] });
    personalSources(settings).set({ file: "~/.desk/keys.yaml", lines: [3] });
    personalSources({}).set(undefined);
    expect(heard).toEqual([{ file: "~/.desk/keys.yaml", lines: [3] }]);
  });
});
