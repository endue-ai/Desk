// @vitest-environment jsdom
// The shortcut bar (ADR 0274): Search on a fresh desk, a "+" that puts plugins and commands on it
// and takes them off, a menu that moves and removes one, and the commands that do the same.
import type { PluginInfo } from "@endue-ai/bridge";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandInfo, CommandSpec } from "../commands";
import { CORE_SETTINGS } from "../core/defaults";
import { Settings } from "../settings";
import type { ShellCtx } from "../shell/context";
import { Store, sampleState } from "../shell/state";
import { mountShortcutBar } from "./ShortcutBar";
import { SHORTCUTS, type Shortcut } from "./shortcuts";

const plugin = (id: string, name: string, over: Partial<PluginInfo> = {}): PluginInfo =>
  ({
    id,
    status: "ready",
    enabled: true,
    builtIn: true,
    revision: 1,
    manifest: { id, name, version: "0.1.0", kind: "ui", surfaces: [] },
    ...over,
  }) as PluginInfo;

const REGISTRY: CommandInfo[] = [
  { id: "desk.palette.open", title: "Search Desk and this computer", keywords: [], provider: "x" },
  { id: "endue.launcher.open", title: "Launcher: Show every plugin", keywords: [], provider: "x" },
  { id: "desk.windows.tile", title: "Tile windows", keywords: ["arrange"], provider: "desk" },
];

function setup(
  plugins: PluginInfo[] = [plugin("endue.notes", "Notes"), plugin("endue.terminal", "Terminal")],
) {
  const settings = new Settings();
  settings.setDefaults(CORE_SETTINGS);
  const defined = new Map<string, CommandSpec>();
  const ran: Array<[string, unknown]> = [];
  const store = new Store(sampleState("en", 0));
  const ctx = {
    store,
    runtime: {
      settings,
      notify: vi.fn(),
      plugins: { listed: () => plugins, onListed: () => () => {} },
      commands: {
        define: (id: string, spec: CommandSpec) => {
          defined.set(id, spec);
          return () => defined.delete(id);
        },
        run: async (id: string, args?: unknown) => {
          ran.push([id, args]);
          return defined.get(id)?.run(args, {});
        },
        list: () => REGISTRY,
        onChange: () => () => {},
      },
    },
  } as unknown as ShellCtx;
  const root = document.createElement("div");
  document.body.append(root);
  const unmount = mountShortcutBar(root, ctx);
  const keys = () =>
    [...root.querySelectorAll<HTMLElement>(".shortcuts button")].map((b) => b.dataset.key);
  const button = (key: string) =>
    root.querySelector<HTMLElement>(`.shortcuts [data-key="${key}"]`) as HTMLElement;
  const choice = (key: string) =>
    root.querySelector<HTMLElement>(`.shortcuts-popover [data-choice="${key}"]`);
  const kept = () => settings.get<Shortcut[]>(SHORTCUTS);
  return { settings, defined, ran, store, root, unmount, keys, button, choice, kept };
}

const press = (key: string, init: KeyboardEventInit = {}) =>
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
  );
const focused = () => (document.activeElement as HTMLElement | null)?.dataset.key;
const rightClick = (el: HTMLElement) =>
  el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));

afterEach(() => document.body.replaceChildren());

describe("the shortcut bar (ADR 0274)", () => {
  it("holds Search, then a +, and tells its layer it has two buttons", () => {
    const { root, keys, button, unmount } = setup();
    expect(root.querySelector(".shortcuts")?.getAttribute("aria-label")).toBe("Shortcuts");
    expect(keys()).toEqual(["shortcut-command:desk.palette.open", "shortcuts-add"]);
    const search = button("shortcut-command:desk.palette.open");
    expect(search.getAttribute("aria-label")).toBe("Search");
    expect(search.querySelector("svg")?.dataset.icon).toBe("search");
    expect(button("shortcuts-add").getAttribute("aria-expanded")).toBe("false");
    expect(root.style.getPropertyValue("--shortcuts-count")).toBe("2");
    unmount();
    expect(root.style.getPropertyValue("--shortcuts-count")).toBe("");
    expect(root.querySelector(".shortcuts")).toBeNull();
  });

  it("a press runs its command, or opens its plugin, and closes what was open", async () => {
    const { settings, store, ran, button } = setup();
    settings.set(SHORTCUTS, [{ command: "desk.palette.open" }, { plugin: "endue.notes" }]);
    const notes = button("shortcut-plugin:endue.notes");
    expect(notes.getAttribute("aria-label")).toBe("Notes");
    // A built-in plugin shows its windows' own icon (ADR 0273).
    expect(notes.querySelector("svg")?.dataset.icon).toBe("note");
    expect(notes.querySelector(".shortcut-letter")).toBeNull();
    store.set({ popover: "account" });
    notes.click();
    expect(store.get().popover).toBeNull();
    button("shortcut-command:desk.palette.open").click();
    await vi.waitFor(() =>
      expect(ran).toEqual([
        ["desk.plugins.open", { plugin: "endue.notes" }],
        ["desk.palette.open", undefined],
      ]),
    );
  });

  it("the + lists the desk's actions and the plugins; a press puts one on or takes it off", () => {
    const { store, root, button, choice, kept, keys } = setup();
    button("shortcuts-add").click();
    expect(store.get().popover).toBe("shortcuts");
    const popover = root.querySelector<HTMLElement>(".shortcuts-popover");
    expect(popover?.getAttribute("role")).toBe("dialog");
    expect(focused()).toBe("shortcuts-filter");
    expect(button("shortcuts-add").getAttribute("aria-expanded")).toBe("true");
    const titles = [...(popover?.querySelectorAll(".pop-title") ?? [])].map((t) => t.textContent);
    expect(titles).toEqual(["Desk", "Plugins"]);
    expect(choice("command:desk.palette.open")?.getAttribute("aria-pressed")).toBe("true");

    choice("plugin:endue.notes")?.click();
    expect(kept()).toEqual([{ command: "desk.palette.open" }, { plugin: "endue.notes" }]);
    expect(keys()).toContain("shortcut-plugin:endue.notes");
    expect(choice("plugin:endue.notes")?.getAttribute("aria-pressed")).toBe("true");
    // The list stays open for the next one; the same press takes it off again.
    expect(store.get().popover).toBe("shortcuts");
    choice("plugin:endue.notes")?.click();
    expect(kept()).toEqual([{ command: "desk.palette.open" }]);
    choice("command:desk.palette.open")?.click();
    expect(kept()).toEqual([]);
    expect(keys()).toEqual(["shortcuts-add"]);
  });

  it("typing finds commands too, Enter takes the first, Escape gives the + the focus", () => {
    const { store, root, button, kept } = setup();
    button("shortcuts-add").click();
    const field = root.querySelector<HTMLInputElement>(".shortcuts-filter") as HTMLInputElement;
    field.value = "tile";
    field.dispatchEvent(new Event("input"));
    const rows = () =>
      [...root.querySelectorAll<HTMLElement>(".shortcuts-choice")].map((r) => r.dataset.choice);
    expect(rows()).toEqual(["command:desk.windows.tile"]);
    // The field is the same element: typing never draws it anew.
    expect(root.querySelector(".shortcuts-filter")).toBe(field);
    press("Enter");
    expect(kept()).toEqual([{ command: "desk.palette.open" }, { command: "desk.windows.tile" }]);
    field.value = "zzz";
    field.dispatchEvent(new Event("input"));
    expect(root.querySelector(".shortcuts-note")?.textContent).toBe("Nothing matches “zzz”");
    press("Escape");
    expect(store.get().popover).toBeNull();
    expect(root.querySelector(".shortcuts-popover")).toBeNull();
    expect(focused()).toBe("shortcuts-add");
  });

  it("the arrows walk from the field to the rows and back", () => {
    const { root, button } = setup();
    button("shortcuts-add").click();
    press("ArrowDown");
    expect(focused()).toBe("choice-command:desk.palette.open");
    press("ArrowDown");
    expect(focused()).toBe("choice-command:endue.launcher.open");
    press("ArrowUp");
    press("ArrowUp");
    expect(focused()).toBe("shortcuts-filter");
    expect(root.querySelector(".shortcuts-popover")).not.toBeNull();
  });

  it("a right-click opens a shortcut's menu, which moves it and takes it off", () => {
    const { settings, store, root, button, kept } = setup();
    settings.set(SHORTCUTS, [
      { command: "desk.palette.open" },
      { plugin: "endue.notes" },
      { plugin: "endue.terminal" },
    ]);
    rightClick(button("shortcut-plugin:endue.notes"));
    expect(store.get().popover).toBe("shortcut-menu");
    const menu = root.querySelector<HTMLElement>(".shortcut-menu");
    expect(menu?.getAttribute("role")).toBe("menu");
    expect(menu?.getAttribute("aria-label")).toBe("Notes shortcut");
    expect(button("shortcut-plugin:endue.notes").getAttribute("aria-expanded")).toBe("true");
    expect(focused()).toBe("shortcut-menu-up");
    press("ArrowDown");
    expect(focused()).toBe("shortcut-menu-down");
    (document.activeElement as HTMLElement).click();
    expect(kept()).toEqual([
      { command: "desk.palette.open" },
      { plugin: "endue.terminal" },
      { plugin: "endue.notes" },
    ]);
    expect(store.get().popover).toBeNull();
    expect(focused()).toBe("shortcut-plugin:endue.notes");

    // Last on the bar, it moves no further down.
    rightClick(button("shortcut-plugin:endue.notes"));
    const down = root.querySelector<HTMLButtonElement>('[data-key="shortcut-menu-down"]');
    expect(down?.disabled).toBe(true);
    root.querySelector<HTMLElement>('[data-key="shortcut-menu-remove"]')?.click();
    expect(kept()).toEqual([{ command: "desk.palette.open" }, { plugin: "endue.terminal" }]);
    expect(focused()).toBe("shortcut-plugin:endue.terminal");
  });

  it("Shift+F10 on a shortcut opens its menu; Escape closes it back to the shortcut", () => {
    const { store, button } = setup();
    button("shortcut-command:desk.palette.open").focus();
    press("F10", { shiftKey: true });
    expect(store.get().popover).toBe("shortcut-menu");
    // Alone on the bar it moves nowhere: its first row that does something is Remove.
    expect(focused()).toBe("shortcut-menu-remove");
    press("Escape");
    expect(store.get().popover).toBeNull();
    expect(focused()).toBe("shortcut-command:desk.palette.open");
  });

  it("desk.shortcuts.add and .remove change the list; with nothing named they open the +", async () => {
    const { defined, store, kept } = setup();
    const add = defined.get("desk.shortcuts.add");
    const remove = defined.get("desk.shortcuts.remove");
    expect(add?.owner).toBe("desk");
    expect(typeof add?.title === "function" ? add.title() : add?.title).toBe("Add a shortcut");
    expect(await add?.run({ plugin: "endue.terminal" }, {})).toEqual({
      shortcuts: [{ command: "desk.palette.open" }, { plugin: "endue.terminal" }],
    });
    await remove?.run({ command: "desk.palette.open" }, {});
    expect(kept()).toEqual([{ plugin: "endue.terminal" }]);
    expect(() => add?.run({ plugin: "endue.notes", command: "x.y" }, {})).toThrow(/Name a plugin/);
    await add?.run({}, {});
    expect(store.get().popover).toBe("shortcuts");
    store.set({ popover: null });
    await remove?.run(undefined, {});
    expect(store.get().popover).toBe("shortcuts");
    // Terminal and eleven more fill the bar; a thirteenth is refused and says why.
    for (let i = 0; i < 11; i++) await add?.run({ plugin: `p.n${i}` }, {});
    expect(kept()).toHaveLength(12);
    expect(() => add?.run({ plugin: "endue.notes" }, {})).toThrow(
      "The bar holds 12 shortcuts at most",
    );
  });

  it("a shortcut whose plugin is gone stays, faint, and says why", () => {
    const { settings, button } = setup();
    settings.set(SHORTCUTS, [{ plugin: "endue.gone" }]);
    const gone = button("shortcut-plugin:endue.gone");
    expect(gone.hasAttribute("data-missing")).toBe(true);
    expect(gone.getAttribute("aria-label")).toBe("endue.gone · Not installed");
    // A plugin the desk has no icon for shows its name's first letter.
    expect(gone.querySelector(".shortcut-letter")?.textContent).toBe("E");
  });

  it("speaks the desk's language", () => {
    const { store, root, button } = setup();
    store.set({ lang: "ko" });
    expect(root.querySelector(".shortcuts")?.getAttribute("aria-label")).toBe("바로가기");
    expect(button("shortcut-command:desk.palette.open").getAttribute("aria-label")).toBe("검색");
    expect(button("shortcuts-add").getAttribute("aria-label")).toBe("바로가기 추가");
  });
});
