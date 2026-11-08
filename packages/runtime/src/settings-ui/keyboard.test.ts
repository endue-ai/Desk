// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Commands } from "../commands";
import { PERSONAL_KEYS, SEQUENCE_TIMEOUT } from "../core/defaults";
import type { Keymap } from "../keymap";
import { type KeyEntry, resolveBindings } from "../sequences/conflicts";
import { Settings } from "../settings";
import { mountKeyboard } from "./keyboard";

describe("keyboard settings", () => {
  const command = "desk.test.command";
  const personal = [{ key: "Control+J", command }];
  let settings: Settings;
  let keyboard: ReturnType<typeof mountKeyboard>;
  let unsubscribe: () => void;

  function button(selector: string): HTMLButtonElement {
    const element = keyboard.el.querySelector<HTMLButtonElement>(selector);
    if (!element) throw new Error(`Missing button: ${selector}`);
    return element;
  }

  beforeEach(() => {
    vi.stubGlobal("CSS", { escape: (value: string) => value });
    settings = new Settings();
    settings.set(PERSONAL_KEYS, personal);
    const listeners = new Set<() => void>();
    const keymap = {
      onChange: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as unknown as Keymap;
    unsubscribe = settings.onChange(() => {
      for (const listener of listeners) listener();
    });
    const commands = {
      list: () => [{ id: command, title: "Test command", keywords: [], provider: "desk" }],
      onChange: () => () => {},
    } as unknown as Commands;
    keyboard = mountKeyboard({
      settings,
      commands,
      keymap,
      contributed: () => [{ key: "Control+N", command, owner: "desk" }],
      platform: "other",
      language: "en",
    });
    document.body.append(keyboard.el);
  });

  afterEach(() => {
    keyboard.dispose();
    unsubscribe();
    keyboard.el.remove();
    vi.unstubAllGlobals();
  });

  it("asks before restoring defaults and preserves bindings on cancel", () => {
    const restoreDefaults = Array.from(keyboard.el.querySelectorAll("button")).find(
      (element) => element.textContent === "Restore Defaults",
    );
    expect(restoreDefaults).toBeDefined();
    restoreDefaults?.click();
    expect(settings.get(PERSONAL_KEYS)).toEqual(personal);
    const confirmation = keyboard.el.querySelector<HTMLElement>(".settings-conflict:not([hidden])");
    expect(confirmation).not.toBeNull();
    expect(confirmation?.querySelector("p")?.textContent?.trim()).toBeTruthy();
    const action = (label: string) => {
      const element = Array.from(confirmation?.querySelectorAll("button") ?? []).find(
        (item) => item.textContent === label,
      );
      if (!element) throw new Error(`Missing confirmation action: ${label}`);
      element.click();
    };
    action("Cancel");
    expect(settings.get(PERSONAL_KEYS)).toEqual(personal);
    expect(confirmation?.hidden).toBe(true);
    restoreDefaults?.click();
    action("Restore");
    expect(settings.get(PERSONAL_KEYS)).toEqual([]);
  });

  it.each(["remove", "reset"])("focuses the change button after %s", (action) => {
    const clicked = button(`[data-key="keys-${action}-${command}"]`);
    expect(clicked.disabled).toBe(false);
    clicked.focus();
    clicked.click();
    expect(document.activeElement).toBe(button(`[data-key="keys-change-${command}"]`));
  });

  it.each(["remove", "reset"])("keeps a shortcut-filtered row focused after %s", (action) => {
    const search = keyboard.el.querySelector<HTMLInputElement>('input[type="search"]');
    if (!search) throw new Error("Missing command search");
    search.value = "Ctrl+J";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    const clicked = button(`[data-key="keys-${action}-${command}"]`);
    clicked.focus();
    clicked.click();
    expect(search.value).toBe("Ctrl+J");
    expect(document.activeElement).toBe(button(`[data-key="keys-change-${command}"]`));
    search.value = "unmatched";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(keyboard.el.querySelector(`[data-command="${command}"]`)).toBeNull();
  });
});

describe("keyboard settings with key sequences (ADR 0118)", () => {
  const command = "desk.test.command";
  const other = "desk.test.other";
  let settings: Settings;
  let keyboard: ReturnType<typeof mountKeyboard>;

  function mount(contributed: KeyEntry[], conflicts: KeyEntry[] = []) {
    vi.stubGlobal("CSS", { escape: (value: string) => value });
    settings = new Settings();
    // The keymap changes when the person's layer does, as desk.keys applies it.
    const listeners = new Set<() => void>();
    settings.onChange(() => {
      for (const listener of listeners) listener();
    });
    const keymap = {
      onChange: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      conflicts: () => resolveBindings(conflicts, "other").conflicts,
    } as unknown as Keymap;
    const commands = {
      list: () => [
        { id: command, title: "Test command", keywords: [], provider: "desk" },
        { id: other, title: "Other command", keywords: [], provider: "desk" },
      ],
      onChange: () => () => {},
    } as unknown as Commands;
    keyboard = mountKeyboard({
      settings,
      commands,
      keymap,
      contributed: () => contributed,
      platform: "other",
      language: "en",
    });
    document.body.append(keyboard.el);
  }
  const press = (key: string, ctrl = false) =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key, ctrlKey: ctrl, bubbles: true, cancelable: true }),
    );
  const change = () =>
    keyboard.el.querySelector<HTMLButtonElement>(`[data-key="keys-change-${command}"]`)?.click();
  const kbds = (selector: string) =>
    [...keyboard.el.querySelectorAll(`${selector} kbd`)].map((k) => k.textContent);
  const personal = () => settings.get<unknown[]>(PERSONAL_KEYS, []);
  /** Turn on "several keys in a row". */
  const several = () => {
    const box = keyboard.el.querySelector<HTMLInputElement>('[data-key="keys-several"]');
    if (box) box.checked = true;
  };

  afterEach(() => {
    keyboard.dispose();
    keyboard.el.remove();
    vi.unstubAllGlobals();
  });

  it("ends a chord at once, as before, unless keys in force continue it", () => {
    mount([{ key: "Control+X Control+F", command: other, owner: "desk" }]);
    change();
    press("j", true);
    expect(personal()).toContainEqual({ key: "Control+J", command });
    change();
    press("x", true);
    expect(keyboard.el.querySelector(".keys-note")?.textContent).toBe(
      "Ctrl+X — Press the next key · Enter to save",
    );
    press("s", true);
    expect(personal()).toContainEqual({ key: "Control+X Control+S", command });
  });

  it("records chords until Enter, plain keys after a prefix, and shows them chord by chord", () => {
    mount([{ key: "Control+N", command, owner: "desk" }]);
    several();
    change();
    press("x", true);
    expect(keyboard.el.querySelector(".keys-note")?.textContent).toBe("Ctrl+X — Enter to save");
    press("p");
    press("f");
    expect(personal()).toEqual([]);
    press("Enter");
    expect(personal()).toContainEqual({ key: "Control+X P F", command });
    expect(kbds(`[data-command="${command}"] .settings-key-combo`)).toEqual(["Ctrl+X", "P", "F"]);
  });

  it("asks before shadowing and shows what would be shadowed; cancel keeps the keys", () => {
    mount([{ key: "Control+K", command: other, owner: "desk" }]);
    several();
    change();
    press("k", true);
    press("s", true);
    press("Enter");
    const asking = keyboard.el.querySelector<HTMLElement>(".settings-conflict:not([hidden])");
    expect(asking?.textContent).toContain("Other command");
    expect(kbds(".settings-conflict .keys-shadowed")).toEqual(["Ctrl+K"]);
    expect(personal()).toEqual([]);
    const action = (label: string) =>
      [...(asking?.querySelectorAll("button") ?? [])].find((b) => b.textContent === label);
    action("Cancel")?.click();
    expect(personal()).toEqual([]);
    change();
    press("k", true);
    press("s", true);
    press("Enter");
    action("Replace Shortcut")?.click();
    expect(personal()).toEqual([
      { key: "Control+K", command: "" },
      { key: "Control+K Control+S", command },
    ]);
  });

  it("refuses a key that can never run", () => {
    mount([]);
    several();
    change();
    press("x", true);
    press("g", true);
    press("Enter");
    const refused = keyboard.el.querySelector<HTMLElement>(".settings-conflict:not([hidden])");
    expect(refused?.textContent).toContain("can never run");
    expect([...(refused?.querySelectorAll("button") ?? [])].map((b) => b.textContent)).toEqual([
      "Cancel",
    ]);
    expect(personal()).toEqual([]);
  });

  it("lists every conflict with its source line, and sets how long a prefix waits", () => {
    mount(
      [],
      [
        { key: "Mod+K", command: other, owner: "desk" },
        {
          key: "Mod+K Mod+S",
          command,
          owner: "person",
          source: { file: "~/.desk/keys.yaml", line: 4 },
        },
        { key: "Mod+J", command: other, owner: "example.a" },
        { key: "Mod+J", command, owner: "example.b" },
      ],
    );
    const section = keyboard.el.querySelector(".keys-conflicts");
    expect(section?.querySelector("h2")?.textContent).toBe("Shortcut conflicts (1)");
    expect(section?.querySelector(".is-warning")?.textContent).toContain("plugin example.a");
    expect(section?.querySelector("details .is-info")?.textContent).toContain(
      "~/.desk/keys.yaml:4",
    );
    const wait = keyboard.el.querySelector<HTMLSelectElement>(`[data-key="${SEQUENCE_TIMEOUT}"]`);
    expect(wait?.value).toBe("0");
    if (wait) wait.value = "1500";
    wait?.dispatchEvent(new Event("change"));
    expect(settings.get(SEQUENCE_TIMEOUT)).toBe(1500);
  });
});
