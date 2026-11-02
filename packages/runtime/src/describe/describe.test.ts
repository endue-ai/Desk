import { readFileSync } from "node:fs";
import type { CallerGrant, PluginInfo, PluginManifest } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { explain, type Facts } from "./describe";

const golden = (name: string) =>
  readFileSync(new URL(`golden/${name}.txt`, import.meta.url), "utf8");

const plugin = (
  manifest: Partial<PluginManifest> & { id: string },
  folder: string,
): PluginInfo => ({
  id: manifest.id,
  status: "ready",
  enabled: true,
  builtIn: true,
  revision: 1,
  folder,
  manifest: { version: "0.1.0", kind: "policy", ...manifest },
});

const grant = (
  grantId: string,
  caller: string,
  permission: CallerGrant["grant"]["permission"],
  duration: "once" | "session" | "always" = "session",
): CallerGrant => ({
  caller,
  grant: { grantId, permission, duration, grantedAt: "2026-11-02T09:00:00Z" },
});

/** A desk on macOS: the keys, files, theme and palette policies and one more plugin. */
function world(over: Partial<Facts> = {}): Facts {
  const plugins = [
    plugin({ id: "desk.keys", name: "Keys" }, "/desk/plugins/keys"),
    plugin(
      {
        id: "desk.files",
        name: "Files",
        description: "Which plugin opens which file, recent files and saving.",
      },
      "/desk/plugins/files",
    ),
    plugin({ id: "desk.theme", name: "Theme" }, "/desk/plugins/theme"),
    plugin(
      {
        id: "desk.palette",
        name: "Palette",
        kind: "ui",
        entry: "ui/index.html",
        description: "System search and the shared picker.",
      },
      "/desk/plugins/palette",
    ),
    {
      ...plugin({ id: "example.notes", name: "Notes", kind: "ui" }, "/home/notes"),
      builtIn: false,
    },
  ];
  return {
    platform: "mac",
    commands: [
      { id: "desk.files.save", title: "Save the file", provider: "desk" },
      { id: "desk.files.open", title: "Open a file", provider: "desk" },
      { id: "desk.palette.open", title: "Search Desk", provider: "desk.palette" },
      { id: "desk.describe.open", title: "Describe…", provider: "desk" },
    ],
    keys: [
      { key: "Mod+K", command: "desk.palette.open", owner: "desk.keys" },
      { key: "Mod+S", command: "desk.files.save", owner: "desk.keys" },
    ],
    plugins,
    declared: {
      "desk.keys.bindings": { kind: "array", default: [], owner: "desk.keys" },
      "desk.files.recent-max": { kind: "integer", default: 20, owner: "desk.files" },
      "desk.palette.history": { kind: "integer", default: 50, owner: "desk.palette" },
      "desk.theme.scheme": {
        kind: "string",
        default: "dark",
        choices: ["system", "light", "dark"],
        description: "Light, dark, or the system's.",
        owner: "desk.theme",
      },
    },
    layers: { init: { "desk.theme.scheme": "light" }, profile: {}, session: {} },
    profile: "default",
    initFile: "~/.desk/init.yaml",
    grants: [
      grant("g1", "desk.palette", { permission: "cmd:invoke", ids: ["*"] }),
      grant("g2", "cli", { permission: "cmd:invoke", ids: ["*"] }),
      grant("g3", "cli", { permission: "perm:manage" }),
      grant("g4", "example.notes", { permission: "cmd:invoke", ids: ["example.notes.*"] }),
      grant("g5", "example.notes", { permission: "fs:write", paths: ["~/Notes/**"] }, "always"),
    ],
    ...over,
  };
}

const facts = (text: string) => text.split("\n").slice(1);
const line = (text: string, label: string) => facts(text).find((l) => l.startsWith(`${label}: `));

describe("explain: a key", () => {
  it("a key: its command, the plugin that binds it and the plugin behind the command", () => {
    const key = explain("key", "Mod+S", world());
    expect(key.name).toBe("Meta+S");
    expect(key.summary).toBe("⌘S runs desk.files.save.");
    expect(key.file).toBe("/desk/plugins/keys/plugin.json");
    expect(`${key.text}\n`).toBe(golden("key"));
    expect(explain("key", "Mod+S", world({ platform: "other" })).summary).toBe(
      "Ctrl+S runs desk.files.save.",
    );
  });

  it("a key the person bound names desk.keys.bindings and the layer that set it", () => {
    const mine = { key: "Mod+S", command: "desk.palette.open", owner: "person" };
    const bound = (layer: "init" | "profile" | "session") =>
      explain(
        "key",
        "Mod+S",
        world({
          keys: [...world().keys, mine],
          profile: "focus",
          layers: {
            init: {},
            profile: {},
            session: {},
            [layer]: { "desk.keys.bindings": [{ key: "Mod+S", command: "desk.palette.open" }] },
          },
        }),
      );
    const init = bound("init");
    expect(init.summary).toBe("⌘S runs desk.palette.open.");
    expect(line(init.text, "Layer")).toBe("Layer: init.yaml, your desk.keys.bindings");
    expect(line(init.text, "Replaces")).toBe(
      "Replaces: desk.files.save (manifest default, desk.keys)",
    );
    expect(init.file).toBe("~/.desk/init.yaml");
    expect(line(bound("profile").text, "Layer")).toBe(
      "Layer: profile focus, your desk.keys.bindings",
    );
    expect(line(bound("session").text, "Layer")).toBe(
      "Layer: this session, your desk.keys.bindings",
    );
    expect(bound("session").file).toBe("/desk/plugins/keys/plugin.json");

    const free = explain("key", "Mod+J", world());
    expect(free.summary).toBe("⌘J is not bound.");
    expect(free.file).toBeUndefined();
    const off = explain("key", "Mod+S", world({ commands: [] }));
    expect(off.summary).toBe("⌘S runs desk.files.save, which is not available now.");
  });
});

describe("explain: a command", () => {
  it("a command: plugin, provider, keys, who may call it, and its undo only when cmd.list carries one", () => {
    const save = explain("command", "desk.files.save", world());
    expect(save.file).toBe("/desk/plugins/files/plugin.json");
    expect(`${save.text}\n`).toBe(golden("command"));
    expect(line(save.text, "Undo")).toBeUndefined();

    const undoable = world({
      commands: [
        { id: "desk.files.save", title: "Save", provider: "desk", undo: "desk.files.revert" },
      ],
    });
    expect(line(explain("command", "desk.files.save", undoable).text, "Undo")).toBe(
      "Undo: desk.files.revert",
    );

    const palette = explain("command", "desk.palette.open", world());
    expect(line(palette.text, "What it is")).toBe("What it is: a command desk.palette provides");
    expect(line(palette.text, "Keys")).toBe("Keys: ⌘K (manifest default, desk.keys)");
    const own = explain("command", "desk.describe.open", world());
    expect(own.summary).toBe("desk.describe.open is a command of the desk itself.");
    expect(own.file).toBeUndefined();
    expect(() => explain("command", "desk.nope.go", world())).toThrow(/No command desk\.nope\.go/);
  });

  it("names who may call it only for an asker that may list grants", () => {
    const hidden = explain(
      "command",
      "desk.files.save",
      world({ grants: undefined, asker: "x.y" }),
    );
    expect(line(hidden.text, "Who may call it")).toBe(
      "Who may call it: you, with its keys or the palette; grants are not shown to x.y",
    );
  });
});

describe("explain: a setting", () => {
  it("a setting in each layer: manifest default, init.yaml, profile, session", () => {
    const at = (layers: Facts["layers"]) =>
      explain("setting", "desk.theme.scheme", world({ layers, profile: "focus" }));
    const none = { init: {}, profile: {}, session: {} };
    const byDefault = at(none);
    expect(byDefault.summary).toBe('desk.theme.scheme is "dark", the manifest default.');
    expect(line(byDefault.text, "Layer")).toBe("Layer: manifest default, desk.theme (Theme)");
    expect(byDefault.file).toBe("/desk/plugins/theme/plugin.json");

    const init = explain("setting", "desk.theme.scheme", world());
    expect(`${init.text}\n`).toBe(golden("setting"));
    expect(init.file).toBe("~/.desk/init.yaml");

    const profile = at({
      ...none,
      init: { "desk.theme.scheme": "light" },
      profile: { "desk.theme.scheme": "system" },
    });
    expect(profile.summary).toBe('desk.theme.scheme is "system", set in profile focus.');
    expect(line(profile.text, "Layers")).toBe(
      'Layers: manifest default "dark"; init.yaml "light"; profile focus "system"',
    );
    expect(profile.file).toBe("/desk/plugins/theme/plugin.json");

    const session = at({
      ...none,
      profile: { "desk.theme.scheme": "system" },
      session: { "desk.theme.scheme": "light" },
    });
    expect(session.summary).toBe('desk.theme.scheme is "light", set in this session.');
    expect(line(session.text, "Layer")).toBe("Layer: this session");
  });

  it("names a value that does not fit as skipped, and a key no plugin declares", () => {
    const skipped = explain(
      "setting",
      "desk.theme.scheme",
      world({ layers: { init: { "desk.theme.scheme": "purple" }, profile: {}, session: {} } }),
    );
    expect(skipped.summary).toBe('desk.theme.scheme is "dark", the manifest default.');
    expect(line(skipped.text, "Layers")).toBe(
      'Layers: manifest default "dark"; init.yaml "purple" (skipped: not system, light or dark)',
    );
    const loose = explain(
      "setting",
      "desk.extra.flag",
      world({ layers: { init: {}, profile: {}, session: { "desk.extra.flag": true } } }),
    );
    expect(loose.summary).toBe("desk.extra.flag is true, set in this session.");
    expect(line(loose.text, "What it is")).toBe("What it is: a setting no plugin declares");
    expect(() => explain("setting", "desk.nope", world())).toThrow(/No setting desk\.nope/);
  });

  it("says a plugin's own setting is read from the core", () => {
    const notes = world({
      declared: {
        ...world().declared,
        "example.notes.font": { kind: "string", default: "serif", owner: "example.notes" },
      },
    });
    expect(line(explain("setting", "example.notes.font", notes).text, "Note")).toBe(
      "Note: example.notes reads its value from the core, where init.yaml's example.notes.font or a value it set itself comes over this default (ADR 0031)",
    );
  });
});

describe("explain: a plugin and a grant", () => {
  it("a plugin and a grant", () => {
    const palette = explain("plugin", "desk.palette", world());
    expect(palette.file).toBe("/desk/plugins/palette/plugin.json");
    expect(`${palette.text}\n`).toBe(golden("plugin"));
    const files = explain("plugin", "desk.files", world());
    expect(line(files.text, "Commands")).toBe("Commands: desk.files.open, desk.files.save");
    expect(line(files.text, "Grants")).toBe("Grants: none");

    const notes = explain("grant", "g5", world());
    expect(notes.file).toBeUndefined();
    expect(`${notes.text}\n`).toBe(golden("grant"));
    const cli = explain("grant", "cli", world());
    expect(cli.summary).toBe("cli (the desk CLI) holds 2 grants.");
    expect(line(cli.text, "g3")).toBe("g3: manage permissions, for this session");
    const invoke = explain("grant", "cmd:invoke", world());
    expect(invoke.summary).toBe("3 grants of cmd:invoke: desk.palette, cli, example.notes.");

    expect(() => explain("plugin", "example.none", world())).toThrow(/No plugin example\.none/);
    expect(() => explain("grant", "g9", world())).toThrow(/No grant g9/);
    expect(() => explain("grant", "g5", world({ grants: undefined, asker: "x.y" }))).toThrow(
      /not shown to x\.y/,
    );
  });
});
