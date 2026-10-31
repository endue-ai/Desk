import type { PluginContributes, PluginInfo } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { collect, globMatch, layers } from "./policy";
import { Settings } from "./settings";

export function plugin(
  id: string,
  contributes: PluginContributes,
  options: Partial<PluginInfo> & { kind?: "ui" | "policy" } = {},
): PluginInfo {
  const { kind = "policy", ...info } = options;
  return {
    id,
    status: "ready",
    enabled: true,
    builtIn: id.startsWith("desk."),
    revision: 1,
    manifest: {
      id,
      version: "0.1.0",
      kind,
      ...(kind === "ui" ? { entry: "ui/index.html" } : {}),
      contributes,
    },
    ...info,
  };
}

describe("layers", () => {
  it("puts built-in desk.* policy plugins first, then the rest as listed", () => {
    const order = layers([
      plugin("example.notes", {}),
      plugin("desk.theme", {}),
      plugin("desk.keys", {}),
      plugin("desk.extra", {}, { builtIn: false }),
    ]).map((p) => p.id);
    expect(order).toEqual(["desk.keys", "desk.theme", "example.notes", "desk.extra"]);
  });

  it("leaves out disabled and failed plugins", () => {
    const order = layers([
      plugin("desk.keys", {}, { enabled: false }),
      plugin("desk.theme", {}, { status: "failed" }),
      plugin("example.on", {}),
    ]).map((p) => p.id);
    expect(order).toEqual(["example.on"]);
  });
});

describe("collect", () => {
  it("keeps keys in layer order and asks later display and file rules first", () => {
    const policy = collect([
      plugin("example.notes", {
        keys: [{ key: "Mod+W", command: "" }],
        display: [{ match: { plugin: "example.notes" }, area: "right" }],
        files: [{ pattern: "*.md", plugin: "example.notes" }],
      }),
      plugin("desk.keys", { keys: [{ key: "Mod+W", command: "desk.buffers.close" }] }),
      plugin("desk.display", { display: [{ match: {}, area: "center" }] }),
      plugin("desk.files", { files: [{ pattern: "*", plugin: "desk.files" }] }),
    ]);
    expect(policy.keys.map((k) => [k.owner, k.command])).toEqual([
      ["desk.keys", "desk.buffers.close"],
      ["example.notes", ""],
    ]);
    expect(policy.display.map((r) => r.owner)).toEqual(["example.notes", "desk.display"]);
    expect(policy.files.map((f) => f.pattern)).toEqual(["*.md", "*"]);
  });

  it("counts an off autoload plugin's file openers in its layer, and nothing else of it", () => {
    const sheets = plugin(
      "example.sheets",
      {
        files: [{ pattern: "*.csv", plugin: "example.sheets" }],
        commands: [{ id: "example.sheets.find", title: "Find" }],
        settings: { "example.sheets.encoding": { kind: "string", default: "auto" } },
      },
      { kind: "ui", enabled: false },
    );
    if (sheets.manifest) sheets.manifest.autoload = true;
    const policy = collect([
      plugin("desk.files", { files: [{ pattern: "*", plugin: "desk.files" }] }),
      sheets,
      plugin("example.mine", { files: [{ pattern: "*.csv", plugin: "example.mine" }] }),
      plugin(
        "example.off",
        { files: [{ pattern: "*.txt", plugin: "example.off" }] },
        {
          enabled: false,
        },
      ),
    ]);
    expect(policy.files.map((f) => f.owner)).toEqual([
      "example.mine",
      "example.sheets",
      "desk.files",
    ]);
    expect(policy.plugins).toEqual(["desk.files", "example.mine"]);
    expect(policy.commands).toEqual([]);
    expect(policy.settings).toEqual({});
  });

  it("drops commands, settings and themes outside the plugin's own id", () => {
    const policy = collect([
      plugin(
        "example.notes",
        {
          commands: [
            { id: "example.notes.new", title: "New note" },
            { id: "desk.files.save", title: "Steal saving" },
          ],
          settings: {
            "example.notes.folder": { kind: "string", default: "~/notes" },
            "desk.notify.dnd": { kind: "boolean", default: true },
          },
          themes: [{ id: "desk.theme.dark", name: "Fake", scheme: "dark", tokens: {} }],
        },
        { kind: "ui" },
      ),
    ]);
    expect(policy.commands.map((c) => c.id)).toEqual(["example.notes.new"]);
    expect(Object.keys(policy.settings)).toEqual(["example.notes.folder"]);
    expect(policy.themes).toEqual([]);
    expect(policy.ignored).toHaveLength(3);
  });

  it("collects palette providers in layer order and ignores one whose command is outside its plugin", () => {
    const policy = collect([
      plugin("example.files", {
        paletteProviders: [
          { command: "example.files.find", title: "Files" },
          { command: "desk.palette.items", title: "Steal the items" },
        ],
      }),
      plugin(
        "desk.palette",
        { paletteProviders: [{ command: "desk.palette.items", title: "Items" }] },
        { kind: "ui" },
      ),
      plugin(
        "example.off",
        { paletteProviders: [{ command: "example.off.find", title: "Off" }] },
        {
          enabled: false,
        },
      ),
    ]);
    expect(policy.paletteProviders).toEqual([
      { command: "desk.palette.items", title: "Items", owner: "desk.palette" },
      { command: "example.files.find", title: "Files", owner: "example.files" },
    ]);
    expect(policy.ignored).toEqual([
      "example.files: palette provider desk.palette.items is outside example.files",
    ]);
  });

  it("lets a later layer's profile replace an earlier one of the same id", () => {
    const policy = collect([
      plugin("example.focus", { profiles: [{ id: "focus", name: "Deep focus" }] }),
      plugin("desk.profiles", {
        profiles: [
          { id: "default", name: "Default" },
          { id: "focus", name: "Focus" },
        ],
      }),
    ]);
    expect(policy.profiles.map((p) => [p.id, p.name])).toEqual([
      ["default", "Default"],
      ["focus", "Deep focus"],
    ]);
  });
});

describe("globMatch", () => {
  it("matches * across any characters and the rest literally", () => {
    expect(globMatch("endue.*", "endue.eris")).toBe(true);
    expect(globMatch("endue.*", "example.eris")).toBe(false);
    expect(globMatch("*.md", "notes.md")).toBe(true);
    expect(globMatch("*.md", "notes.mdx")).toBe(false);
    expect(globMatch("a.b", "aXb")).toBe(false);
  });
});

describe("Settings", () => {
  const defaults = {
    "desk.notify.dnd": { kind: "boolean" as const, default: false },
    "desk.theme.scheme": {
      kind: "string" as const,
      default: "system",
      choices: ["system", "light", "dark"],
    },
  };

  it("layers defaults, init.yaml, the profile and the session in that order", () => {
    const settings = new Settings();
    settings.setDefaults(defaults);
    expect(settings.get("desk.theme.scheme")).toBe("system");
    settings.setLayer("init", { "desk.theme.scheme": "dark" });
    expect(settings.get("desk.theme.scheme")).toBe("dark");
    settings.setLayer("profile", { "desk.theme.scheme": "light" });
    expect(settings.get("desk.theme.scheme")).toBe("light");
    settings.set("desk.theme.scheme", "dark");
    expect(settings.get("desk.theme.scheme")).toBe("dark");
    settings.reset("desk.theme.scheme");
    expect(settings.get("desk.theme.scheme")).toBe("light");
  });

  it("skips a value of the wrong kind so the layer below shows through", () => {
    const settings = new Settings();
    settings.setDefaults(defaults);
    settings.setLayer("init", { "desk.notify.dnd": "yes", "desk.theme.scheme": "purple" });
    expect(settings.get("desk.notify.dnd")).toBe(false);
    expect(settings.get("desk.theme.scheme")).toBe("system");
    expect(settings.problems).toHaveLength(2);
  });

  it("tells listeners which keys changed value", () => {
    const settings = new Settings();
    settings.setDefaults(defaults);
    const changes: string[][] = [];
    settings.onChange((keys) => changes.push(keys));
    settings.set("desk.notify.dnd", true);
    settings.set("desk.notify.dnd", true);
    settings.setLayer("init", { "desk.notify.dnd": true });
    expect(changes).toEqual([["desk.notify.dnd"]]);
  });
});
