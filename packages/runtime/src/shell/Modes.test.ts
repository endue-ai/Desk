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

  it("offers the profile in force its layout, a new name and deleting it, when it is the person's", () => {
    chip("scratch")?.click();
    expect(items()).toEqual(["menu-save", "menu-new", "menu-revert", "menu-rename", "menu-remove"]);
    expect(chip("scratch")?.getAttribute("aria-expanded")).toBe("true");
    // The first item the person can use has the focus.
    expect(document.activeElement?.getAttribute("data-key")).toBe("menu-new");
  });

  it("opens any profile's menu on right-click, under it; a plugin's profile only renames", () => {
    store.set({ modesOpen: true });
    rightClick(chip("morning"));
    expect(root.querySelector(".mode-menu")?.getAttribute("data-menu-for")).toBe("morning");
    expect(items()).toEqual(["menu-rename"]);
    rightClick(chip("night"));
    expect(items()).toEqual(["menu-rename", "menu-restore"]);
  });

  it("walks the menu with the arrow keys and gives the focus back to its chip on Esc", () => {
    store.set({ modesOpen: true });
    rightClick(chip("night"));
    expect(document.activeElement?.getAttribute("data-key")).toBe("menu-rename");
    press("ArrowDown");
    expect(document.activeElement?.getAttribute("data-key")).toBe("menu-restore");
    press("ArrowDown");
    expect(document.activeElement?.getAttribute("data-key")).toBe("menu-rename");
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
    store.set({ modesOpen: true });
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
