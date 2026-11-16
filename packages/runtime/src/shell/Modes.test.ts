// @vitest-environment jsdom
import type { ProfileContribution } from "@endue-ai/bridge";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { baseMode, MODE, profileMode } from "../modes/profiles";
import type { ShellCtx } from "./context";
import { mountModes } from "./Modes";
import { Store, sampleState } from "./state";

const lays = { [MODE]: { icon: "moon" } };
/** The plugins' profiles: Default (desk.profiles') and two that lay the desk out. */
const contributed: ProfileContribution[] = [
  { id: "default", name: "Default" },
  { id: "morning", name: "Morning", settings: lays },
  { id: "night", name: "Night", settings: lays },
];
/** What desk.profiles lists: the person saved `scratch` and saved over `night`. */
const listed: ProfileContribution[] = [
  contributed[0] as ProfileContribution,
  contributed[1] as ProfileContribution,
  { id: "night", name: "Late night", plugins: {}, settings: lays },
  { id: "scratch", name: "ㅎㅇㅎㅇ", plugins: {}, settings: lays },
];

describe("the profile switcher", () => {
  let root: HTMLDivElement;
  let store: Store;
  let dispose: () => void;
  const run = vi.fn(async (_id: string, _args?: unknown) => undefined);
  const notify = vi.fn();

  beforeEach(() => {
    run.mockClear();
    notify.mockClear();
    const base = baseMode(undefined);
    store = new Store(sampleState("en", 0));
    store.set({ modes: [base, ...listed.map((p) => profileMode(p, base))], modeId: "scratch" });
    root = document.createElement("div");
    document.body.append(root);
    const ctx = {
      store,
      tr: (key: string, vars?: Record<string, unknown>) =>
        vars ? `${key} ${JSON.stringify(vars)}` : key,
      ticker: { animate: (_ms: number, _ease: unknown, update: (t: number) => void) => update(1) },
      reduced: () => true,
      runtime: {
        commands: { run, list: () => [] },
        notify,
        profiles: { list: () => listed, saved: () => ["night", "scratch"] },
        policy: () => ({ profiles: contributed.map((p) => ({ ...p, owner: "desk.shell" })) }),
        settings: { set: vi.fn(), reset: vi.fn(), layer: () => ({}) },
      },
    } as unknown as ShellCtx;
    dispose = mountModes(root, ctx);
  });

  afterEach(() => {
    dispose();
    root.remove();
  });

  const chip = (id: string) => root.querySelector<HTMLElement>(`.mode-chip[data-mode="${id}"]`);
  const items = () =>
    [...root.querySelectorAll<HTMLElement>(".mode-menu [role=menuitem]")].map((i) => i.dataset.key);
  const rightClick = (el: HTMLElement | null) =>
    el?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  const dialog = () => root.querySelector<HTMLFormElement>("[role=dialog]");
  const press = (key: string) =>
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

  it("shows one chip, the profile in force, with a chevron, and nothing unfolds", () => {
    const chips = () => root.querySelectorAll<HTMLElement>(".modes .mode-chip");
    expect(chips()).toHaveLength(1);
    const only = chips()[0] as HTMLElement;
    expect(only.dataset.mode).toBe("scratch");
    expect(only.classList.contains("is-current")).toBe(true);
    expect(only.getAttribute("aria-haspopup")).toBe("menu");
    expect(only.getAttribute("aria-expanded")).toBe("false");
    expect(only.querySelector('svg[data-icon="chevron-down"]')).not.toBeNull();
    // The chip stands alone in the row, the box a window's title keeps clear of.
    const row = root.querySelector<HTMLElement>(".modes-row");
    expect([...(row?.children ?? [])]).toEqual([only]);
    expect(root.querySelector(".modes-more")).toBeNull();
    expect(root.querySelector(".mode-add")).toBeNull();
    row?.dispatchEvent(new PointerEvent("pointerenter"));
    row?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(chips()).toHaveLength(1);
    expect(root.querySelector(".mode-menu")).toBeNull();
  });

  it("keeps the changed mark and the copied-from note on the chip", () => {
    store.set({ wm: { ...store.get().wm, dirty: true } });
    expect(chip("scratch")?.querySelector(".mode-dirty")).not.toBeNull();
    const base = baseMode(undefined);
    const copied = profileMode(
      {
        id: "studio",
        name: "Studio",
        settings: { [MODE]: { copiedFrom: { author: "Mina", id: "studio", version: "1.0.0" } } },
      },
      base,
    );
    store.set({ modes: [...store.get().modes, copied], modeId: "studio" });
    const studio = chip("studio");
    expect(studio?.querySelector(".mode-copied")?.textContent).toBe("Mina");
    expect(studio?.getAttribute("aria-label")).toBe('Studio · copiedFrom {"author":"Mina"}');
  });

  it("the menu lists every other profile, New profile, then the profile's own rows", () => {
    chip("scratch")?.click();
    const menu = root.querySelector<HTMLElement>(".mode-menu");
    expect(menu?.getAttribute("role")).toBe("menu");
    expect(chip("scratch")?.getAttribute("aria-expanded")).toBe("true");
    expect(items()).toEqual([
      "menu-switch-default",
      "menu-switch-morning",
      "menu-switch-night",
      "menu-new",
      "menu-save",
      "menu-revert",
      "menu-rename",
      "menu-remove",
    ]);
    // A rule after the profiles and one after New profile.
    const keys = [...(menu?.children ?? [])].map((c) =>
      c.getAttribute("role") === "separator" ? "|" : (c.getAttribute("data-key") ?? ""),
    );
    expect(keys.slice(0, 6)).toEqual([
      "menu-switch-default",
      "menu-switch-morning",
      "menu-switch-night",
      "|",
      "menu-new",
      "|",
    ]);
    const row = (key: string) => menu?.querySelector<HTMLElement>(`[data-key="${key}"]`);
    expect(
      ["default", "morning", "night"].map((id) => row(`menu-switch-${id}`)?.dataset.mode),
    ).toEqual(["default", "morning", "night"]);
    expect(
      ["default", "morning", "night"].map((id) => row(`menu-switch-${id}`)?.textContent),
    ).toEqual(["Default", "Morning", "Late night"]);
    expect(row("menu-new")?.textContent).toBe("newMode");
    expect(document.activeElement?.getAttribute("data-key")).toBe("menu-switch-default");
  });

  it("switches from the menu", () => {
    chip("scratch")?.click();
    root.querySelector<HTMLElement>('[data-key="menu-switch-morning"]')?.click();
    expect(run).toHaveBeenCalledWith("desk.profiles.switch", { id: "morning" });
    expect(root.querySelector(".mode-menu")).toBeNull();
    expect(document.activeElement).toBe(chip("scratch"));
  });

  it("New profile opens the dialog that names the desk as it is", () => {
    chip("scratch")?.click();
    root.querySelector<HTMLElement>('[data-key="menu-new"]')?.click();
    expect(store.get().dialog).toBe("new-mode");
    expect(dialog()).not.toBeNull();
    store.set({ dialog: null });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(chip("scratch"));
  });

  it("right-click opens the same menu; a plugin's profile only renames, one saved over restores", () => {
    const own = () =>
      items().filter((key) => !key?.startsWith("menu-switch-") && key !== "menu-new");
    store.set({ modeId: "morning" });
    rightClick(chip("morning"));
    expect(root.querySelector(".mode-menu")?.getAttribute("data-menu-for")).toBe("morning");
    expect(own()).toEqual(["menu-save", "menu-revert", "menu-rename"]);
    press("Escape");
    store.set({ modeId: "night" });
    rightClick(chip("night"));
    expect(own()).toEqual(["menu-save", "menu-revert", "menu-rename", "menu-restore"]);
    press("Escape");
    store.set({ modeId: "scratch" });
    rightClick(chip("scratch"));
    expect(own()).toEqual(["menu-save", "menu-revert", "menu-rename", "menu-remove"]);
  });

  it("walks the menu with the arrow keys and gives the focus back to the chip on Esc", () => {
    store.set({ modeId: "night" });
    rightClick(chip("night"));
    // Default, Morning, Scratch, New profile, then Rename and Restore: Save and Revert are off.
    const walk = [
      "menu-switch-default",
      "menu-switch-morning",
      "menu-switch-scratch",
      "menu-new",
      "menu-rename",
      "menu-restore",
    ];
    expect(document.activeElement?.getAttribute("data-key")).toBe(walk[0]);
    for (const key of [...walk.slice(1), walk[0]]) {
      press("ArrowDown");
      expect(document.activeElement?.getAttribute("data-key")).toBe(key);
    }
    press("ArrowUp");
    expect(document.activeElement?.getAttribute("data-key")).toBe("menu-restore");
    press("Home");
    expect(document.activeElement?.getAttribute("data-key")).toBe("menu-switch-default");
    press("End");
    expect(document.activeElement?.getAttribute("data-key")).toBe("menu-restore");
    press("Escape");
    expect(root.querySelector(".mode-menu")).toBeNull();
    expect(document.activeElement).toBe(chip("night"));
  });

  it("renames a profile as it is saved, its settings and plugins, not this setup", async () => {
    chip("scratch")?.click();
    root.querySelector<HTMLElement>("[data-key=menu-rename]")?.click();
    const input = dialog()?.querySelector("input") as HTMLInputElement;
    const save = dialog()?.querySelector<HTMLButtonElement>("button[type=submit]");
    expect(input.value).toBe("ㅎㅇㅎㅇ");
    input.value = "   ";
    input.dispatchEvent(new Event("input"));
    expect(save?.disabled).toBe(true);
    input.value = "  Writing   time ";
    input.dispatchEvent(new Event("input"));
    expect(save?.disabled).toBe(false);
    dialog()?.requestSubmit();
    await vi.waitFor(() => expect(run).toHaveBeenCalled());
    expect(run).toHaveBeenCalledWith("desk.profiles.save", {
      id: "scratch",
      name: "Writing time",
      plugins: {},
      settings: lays,
    });
    expect(dialog()).toBeNull();
  });

  it("deletes the person's profile in force after asking, going to Default first", async () => {
    chip("scratch")?.click();
    root.querySelector<HTMLElement>("[data-key=menu-remove]")?.click();
    expect(dialog()?.textContent).toContain('removeModeTitle {"name":"ㅎㅇㅎㅇ"}');
    expect(dialog()?.textContent).toContain('removeModeHint {"home":"Default"}');
    // Cancel holds the focus, so Enter never deletes.
    expect(document.activeElement?.textContent).toBe("cancel");
    root.querySelector<HTMLElement>("[data-key=mode-remove-confirm]")?.click();
    await vi.waitFor(() => expect(notify).toHaveBeenCalled());
    expect(run.mock.calls).toEqual([
      ["desk.profiles.switch", { id: "default" }],
      ["desk.profiles.remove", { id: "scratch" }],
    ]);
    expect(notify.mock.calls[0]?.[0]).toMatchObject({ title: 'modeRemoved {"name":"ㅎㅇㅎㅇ"}' });
  });

  it("restores a plugin's profile the person saved over, under the plugin's name", async () => {
    store.set({ modeId: "night" });
    rightClick(chip("night"));
    root.querySelector<HTMLElement>("[data-key=menu-restore]")?.click();
    expect(dialog()?.textContent).toContain("restoreModeHint");
    root.querySelector<HTMLElement>("[data-key=mode-remove-confirm]")?.click();
    await vi.waitFor(() => expect(notify).toHaveBeenCalled());
    expect(run.mock.calls).toEqual([["desk.profiles.remove", { id: "night" }]]);
    expect(notify.mock.calls[0]?.[0]).toMatchObject({ title: 'modeRestored {"name":"Night"}' });
  });

  it("keeps Save off in the new profile dialog until there is a name", () => {
    store.set({ dialog: "new-mode" });
    const input = dialog()?.querySelector("input") as HTMLInputElement;
    const save = dialog()?.querySelector<HTMLButtonElement>("button[type=submit]");
    expect(save?.disabled).toBe(true);
    input.value = "Quiet";
    input.dispatchEvent(new Event("input"));
    expect(save?.disabled).toBe(false);
    store.set({ dialog: null });
    expect(dialog()).toBeNull();
  });
});
