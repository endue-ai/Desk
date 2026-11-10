import { readFileSync } from "node:fs";
import type { PluginManifest } from "@endue-ai/bridge";
import { describe, expect, test } from "vitest";
import type { CommandInfo, CommandSpec } from "../commands";
import { DEFAULT_KEYS } from "../core/keys";
import { resolveKeymap } from "../keymap";
import { testWindowManager } from "../wm/testing";
import { takeDesk } from "../wm/view";
import { desktopsOf, layoutOf } from "./actions";
import { defineCommands, match, segment } from "./commands";
import type { ShellCtx } from "./context";
import { emptyState, Store } from "./state";

const command = (id: string, title: string, keywords: string[]): CommandInfo => ({
  id,
  title,
  keywords,
  provider: "desk",
});

const list = [
  command("desk.display.new-surface", "표면 · 새 표면", ["new", "window", "새", "표면"]),
  command("desk.shell.open-calendar", "열기 · 캘린더", ["calendar", "캘린더"]),
  command("desk.shell.profile-night", "프로필 · Night", ["Night", "night"]),
  command("desk.keys.quit", "Quit what is in progress", ["cancel", "escape"]),
];

test("keywords that start with the query come first, then keywords or titles that contain it", () => {
  expect(match(list, "cal").map((c) => c.id)).toEqual(["desk.shell.open-calendar"]);
  expect(match(list, "새 표면").map((c) => c.id)).toEqual(["desk.display.new-surface"]);
  expect(match(list, "ight").map((c) => c.id)).toEqual(["desk.shell.profile-night"]);
  expect(match(list, "   ")).toEqual([]);
});

test("profile ids and agent slugs make valid command ids", () => {
  expect(segment("deep-work")).toBe("deep-work");
  expect(segment("My_desk.v2")).toBe("my-desk-v2");
});

describe("desktops' commands and keys (ADR 0117)", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../../../../plugins/shell/plugin.json", import.meta.url), "utf8"),
  ) as PluginManifest;
  const shellKeys = (manifest.contributes?.keys ?? []).map((key) => ({
    ...key,
    owner: "desk.shell",
  }));
  const bindings = (platform: "mac" | "other") =>
    resolveKeymap([...DEFAULT_KEYS, ...shellKeys], platform);
  const keymap = (platform: "mac" | "other") =>
    new Map(bindings(platform).map((b) => [b.combo, b.command]));

  test("Mod+1…9 switch to the first nine desktops; ⌃1…⌃4 still do", () => {
    const mac = keymap("mac");
    for (let n = 1; n <= 9; n++) expect(mac.get(`Meta+${n}`)).toBe(`desk.shell.desktop-${n}`);
    for (let n = 1; n <= 4; n++) expect(mac.get(`Control+${n}`)).toBe(`desk.shell.desktop-${n}`);
    // Elsewhere Mod is Control: still one binding for each key, the same command.
    const one = bindings("other").filter((b) => b.combo === "Control+1");
    expect(one.map((b) => b.command)).toEqual(["desk.shell.desktop-1"]);
    expect(keymap("other").get("Control+9")).toBe("desk.shell.desktop-9");
  });

  test("Mod+Shift+1…9 move the window in use; Mod+Shift+] [ \\ go next, back and to the overview", () => {
    for (const [platform, mod] of [
      ["mac", "Meta"],
      ["other", "Control"],
    ] as const) {
      const map = keymap(platform);
      for (let n = 1; n <= 9; n++)
        expect(map.get(`${mod}+Shift+${n}`)).toBe(`desk.shell.move-to-desktop-${n}`);
      expect(map.get(`${mod}+Shift+]`)).toBe("desk.shell.desktop-next");
      expect(map.get(`${mod}+Shift+[`)).toBe("desk.shell.desktop-previous");
      expect(map.get(`${mod}+Shift+\\`)).toBe("desk.shell.desktops-overview");
    }
  });

  test("no desktop key takes a key the desk binds to something else", () => {
    for (const platform of ["mac", "other"] as const) {
      const before = new Map(
        resolveKeymap(DEFAULT_KEYS, platform).map((b) => [b.combo, b.command]),
      );
      for (const key of shellKeys) {
        const [binding] = resolveKeymap([key], platform);
        const had = binding && before.get(binding.combo);
        if (had) expect(had).toBe(key.command);
      }
    }
  });

  test("the commands add, switch, rename, reorder and move windows; desktop-N follows the list", async () => {
    const c = fakeShell();
    const off = defineCommands(c.ctx);
    for (const id of [
      "desk.shell.desktop-new",
      "desk.shell.desktop-next",
      "desk.shell.desktop-previous",
      "desk.shell.desktop-rename",
      "desk.shell.desktop-remove",
      "desk.shell.desktop-move-left",
      "desk.shell.desktop-move-right",
      "desk.shell.desktops-overview",
      "desk.shell.move-to-desktop",
      "desk.shell.desktop-undo",
      "desk.shell.desktop-4",
      "desk.shell.move-to-desktop-4",
    ])
      expect(c.defined(), id).toContain(id);
    expect(c.defined()).not.toContain("desk.shell.desktop-5");
    await c.run("desk.shell.desktop-new", { name: "Research" });
    expect(c.store.get().desktop).toBe("5");
    expect(c.defined()).toContain("desk.shell.desktop-5");
    expect(c.title("desk.shell.desktop-5")).toBe("cmdDesktop Research");
    await c.run("desk.shell.desktop-next");
    expect(c.store.get().desktop).toBe("1");
    await c.run("desk.shell.desktop-previous");
    expect(c.store.get().desktop).toBe("5");
    await c.run("desk.shell.desktop-rename", { desktop: 2, name: "Mail" });
    await c.run("desk.shell.desktop-move-left");
    expect(desktopsOf(c.store.get()).map((d) => d.name)).toEqual([
      "1",
      "Mail",
      "3",
      "Research",
      "4",
    ]);
    // The window in use goes to desktop 2 and is the one in use there.
    await c.ctx.wm.edit([
      { op: "place", desktop: "5", placement: notes },
      { op: "focus", window: "notes" },
    ]);
    await c.run("desk.shell.move-to-desktop-2");
    expect(layoutOf(c.store.get(), "2").surfaces.map((p) => p.id)).toEqual(["notes"]);
    expect(layoutOf(c.store.get(), "5").surfaces).toEqual([]);
    await c.run("desk.shell.desktop-2");
    expect(c.store.get().focused).toBe("notes");
    await c.run("desk.shell.desktop-undo");
    expect(layoutOf(c.store.get(), "5").surfaces.map((p) => p.id)).toEqual(["notes"]);
    off();
    expect(c.defined()).toEqual([]);
  });
});

const notes = { id: "notes", plugin: "endue.notes", x: 100, y: 100, w: 300, h: 200, pinned: false };

/**
 * The shell's commands over a store and desk-wm, with a registry that runs them at once and no
 * core behind.
 */
function fakeShell() {
  const store = new Store(emptyState("en"));
  const wm = testWindowManager();
  wm.connect((published) => takeDesk(store, published));
  const specs = new Map<string, CommandSpec>();
  const commands = {
    define: (id: string, spec: CommandSpec) => {
      specs.set(id, spec);
      return () => {
        if (specs.get(id) === spec) specs.delete(id);
      };
    },
    has: (id: string) => specs.has(id),
    run: async (id: string, args?: unknown) => specs.get(id)?.run(args, {}),
  };
  const ctx = {
    store,
    wm,
    runtime: {
      commands,
      settings: { set: () => {} },
      shortcuts: { focused: null },
      focusSurface: () => {},
      notify: () => undefined,
    },
    tr: (key: string, vars?: Record<string, string | number>) =>
      vars ? `${key} ${Object.values(vars).join(" ")}` : key,
  } as unknown as ShellCtx;
  const desktopCommand = (id: string) =>
    /^desk\.shell\.(desktop|desktops|move-to-desktop)\b/.test(id);
  return {
    ctx,
    store,
    run: commands.run,
    defined: () => [...specs.keys()].filter(desktopCommand),
    title: (id: string) => specs.get(id)?.title,
  };
}
