// The shortcut bar's list and what its "+" offers (ADR 0274): plain data, no DOM.
import type { PluginInfo } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import type { CommandInfo } from "../commands";
import {
  added,
  choices,
  DEFAULT_SHORTCUTS,
  iconOf,
  type Known,
  keyOf,
  labelOf,
  MAX,
  matching,
  moved,
  removed,
  type Shortcut,
  shortcutOf,
  shortcutsOf,
} from "./shortcuts";

const plugin = (
  id: string,
  name: string,
  placement?: string,
  over: Partial<PluginInfo> = {},
): PluginInfo =>
  ({
    id,
    status: "ready",
    enabled: true,
    builtIn: true,
    revision: 1,
    manifest: {
      id,
      name,
      version: "0.1.0",
      kind: "ui",
      surfaces: placement ? [{ id: "main", title: name, placement }] : [],
    },
    ...over,
  }) as PluginInfo;

const command = (id: string, title: string, keywords: string[] = []): CommandInfo => ({
  id,
  title,
  keywords,
  provider: "desk",
});

const known = (over: Partial<Known> = {}): Known => ({
  plugins: [
    plugin("endue.terminal", "Terminal", "center"),
    plugin("endue.notes", "Notes", "floating"),
    plugin("endue.files", "Files"),
    plugin("endue.toolbar", "Status", "right"),
    plugin("endue.launcher", "Launcher", "overlay"),
    plugin("endue.broken", "Broken", "center", { status: "failed", error: "no entry" }),
    {
      ...plugin("endue.today", "Today"),
      manifest: { ...plugin("x", "Today").manifest, kind: "view" },
    } as PluginInfo,
  ],
  commands: [
    command("desk.palette.open", "Search Desk and this computer", ["search"]),
    command("endue.launcher.open", "Launcher: Show every plugin"),
    command("desk.settings.open", "Settings"),
    command("desk.windows.tile", "Tile windows", ["arrange"]),
    command("desk.shortcuts.add", "Add a shortcut"),
  ],
  named: (id) => ({ "desk.palette.open": "Search", "endue.launcher.open": "All plugins" })[id],
  ...over,
});

describe("the shortcut list (desk.shell.shortcuts)", () => {
  it("reads a plugin or a command each once, in order, at most twelve", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ plugin: `p.n${i}` }));
    expect(shortcutsOf(many)).toHaveLength(MAX);
    expect(
      shortcutsOf([
        { command: "desk.palette.open" },
        { plugin: "endue.notes" },
        { plugin: "endue.notes" },
        { plugin: "endue.notes", command: "desk.palette.open" },
        { plugin: "has space" },
        { command: "desk.shortcuts.add" },
        "endue.notes",
        null,
        { plugin: "endue.files", extra: true },
      ]),
    ).toEqual([
      { command: "desk.palette.open" },
      { plugin: "endue.notes" },
      { plugin: "endue.files" },
    ]);
  });

  it("a value that is no list is Search alone; an empty list is an empty bar", () => {
    expect(shortcutsOf(undefined)).toEqual(DEFAULT_SHORTCUTS);
    expect(shortcutsOf("desk.palette.open")).toEqual(DEFAULT_SHORTCUTS);
    expect(shortcutsOf([])).toEqual([]);
    expect(shortcutOf({ command: "desk.shortcuts.remove" })).toBeUndefined();
  });

  it("adds at the end once, never past twelve, removes and moves within the list", () => {
    const notes: Shortcut = { plugin: "endue.notes" };
    const search: Shortcut = { command: "desk.palette.open" };
    const files: Shortcut = { plugin: "endue.files" };
    expect(added([search], notes)).toEqual([search, notes]);
    expect(added([search, notes], notes)).toEqual([search, notes]);
    const full = Array.from({ length: MAX }, (_, i) => ({ plugin: `p.n${i}` }));
    expect(added(full, notes)).toEqual(full);
    expect(removed([search, notes], search)).toEqual([notes]);
    expect(moved([search, notes, files], files, -1)).toEqual([search, files, notes]);
    expect(moved([search, notes, files], search, -1)).toEqual([search, notes, files]);
    expect(moved([search, notes, files], search, 1)).toEqual([notes, search, files]);
    expect(keyOf(notes)).toBe("plugin:endue.notes");
    expect(keyOf(search)).toBe("command:desk.palette.open");
  });

  it("shows a desk action's icon and a built-in plugin's own; other shortcuts a letter", () => {
    expect(iconOf({ command: "desk.palette.open" })).toBe("search");
    expect(iconOf({ command: "endue.launcher.open" })).toBe("grid");
    expect(iconOf({ plugin: "endue.terminal" })).toBe("terminal");
    expect(iconOf({ plugin: "endue.notes" })).toBe("note");
    expect(iconOf({ plugin: "someone.weather" })).toBeUndefined();
    expect(iconOf({ command: "desk.windows.tile" })).toBeUndefined();
  });
});

describe("what the + offers", () => {
  it("the desk's actions it knows, then the plugins that open on the desk, then other commands", () => {
    const all = choices(known());
    expect(all.map((c) => [c.group, c.name])).toEqual([
      ["desk", "Search"],
      ["desk", "All plugins"],
      ["desk", "Settings"],
      ["plugins", "Files"],
      ["plugins", "Notes"],
      ["plugins", "Terminal"],
      ["commands", "Tile windows"],
    ]);
  });

  it("with nothing typed: the actions, the plugins, and only the commands already on the bar", () => {
    const all = choices(known());
    const names = (on: Shortcut[]) => matching(all, "", on).map((c) => c.name);
    expect(names([])).not.toContain("Tile windows");
    expect(names([{ command: "desk.windows.tile" }])).toContain("Tile windows");
  });

  it("typed: names that start with it, a word of the name, the id or keywords, then the inside", () => {
    const all = choices(known());
    const found = (typed: string) => matching(all, typed, []).map((c) => c.name);
    // "te" inside Notes, or inside Search's "…this computer", finds neither: too short.
    expect(found("te")).toEqual(["Terminal"]);
    expect(found("ote")).toEqual(["Notes"]);
    // All plugins by its command's own title, "Launcher: Show every plugin".
    expect(found("s")).toEqual(["Search", "Settings", "All plugins"]);
    expect(found("w")).toEqual(["Tile windows"]);
    expect(found("pl")).toEqual(["All plugins"]);
    // The title's words and the keywords find what the bar names otherwise.
    expect(found("computer")).toEqual(["Search"]);
    expect(found("arrange")).toEqual(["Tile windows"]);
    expect(found("endue.files")).toEqual(["Files"]);
    expect(found("files")).toEqual(["Files"]);
    // An id's owner finds nothing: every one of these ids starts with "endue" (or "desk").
    expect(found("endue")).toEqual([]);
    expect(found("desk.windows")).toEqual(["Tile windows"]);
    expect(found("zzz")).toEqual([]);
  });

  it("finds Korean names by a word's start", () => {
    const all = choices(
      known({
        named: (id) =>
          ({ "desk.palette.open": "검색", "endue.launcher.open": "모든 플러그인" })[id],
      }),
    );
    const found = (typed: string) => matching(all, typed, []).map((c) => c.name);
    expect(found("검")).toEqual(["검색"]);
    expect(found("플러그")).toEqual(["모든 플러그인"]);
  });

  it("names a shortcut, and says when its plugin or command is gone once they are listed", () => {
    expect(labelOf({ plugin: "endue.notes" }, known())).toEqual({ name: "Notes", missing: false });
    expect(labelOf({ plugin: "endue.broken" }, known())).toEqual({ name: "Broken", missing: true });
    expect(labelOf({ plugin: "endue.gone" }, known())).toEqual({
      name: "endue.gone",
      missing: true,
    });
    expect(labelOf({ command: "desk.palette.open" }, known())).toEqual({
      name: "Search",
      missing: false,
    });
    expect(labelOf({ command: "endue.gone.open" }, known()).missing).toBe(true);
    // Before the first lists, nothing is missing.
    const early = known({ plugins: [], commands: [] });
    expect(labelOf({ plugin: "endue.notes" }, early)).toEqual({
      name: "endue.notes",
      missing: false,
    });
    expect(labelOf({ command: "desk.palette.open" }, early)).toEqual({
      name: "Search",
      missing: false,
    });
  });
});
