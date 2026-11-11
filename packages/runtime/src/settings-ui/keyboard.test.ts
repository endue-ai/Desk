// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
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
    // A command without a key yet is in All commands.
    keyboard.el.querySelector<HTMLButtonElement>('[data-key="keys-view-all"]')?.click();
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

  it("lists every conflict in a person's words, hides them while searching, and sets how long a prefix waits", () => {
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
    const section = () => keyboard.el.querySelector(".keys-conflicts");
    expect(section()?.querySelector("h2")?.textContent).toBe("Shortcut conflicts (1)");
    const warning = section()?.querySelector(".is-warning");
    expect(warning?.querySelector("strong")?.textContent).toBe("Other command");
    expect(warning?.textContent).toContain(
      "“Test command” has this key too and runs instead (set by example.b).",
    );
    expect(warning?.querySelector("small")?.textContent).toBe("Set by example.a");
    const settled = section()?.querySelector("details .is-info");
    expect(settled?.textContent).toContain("Ctrl+K Ctrl+S starts with this key");
    expect(settled?.querySelector("small")?.textContent).toBe("Built in");
    expect(section()?.textContent).not.toContain("keys.yaml");
    // A search puts its matches at the top: the conflicts wait until it is cleared.
    const search = keyboard.el.querySelector<HTMLInputElement>('input[type="search"]');
    if (!search) throw new Error("Missing command search");
    search.value = "other";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(section()).toBeNull();
    search.value = "";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(section()).not.toBeNull();
    const wait = keyboard.el.querySelector<HTMLSelectElement>(`[data-key="${SEQUENCE_TIMEOUT}"]`);
    expect(wait?.value).toBe("0");
    if (wait) wait.value = "1500";
    wait?.dispatchEvent(new Event("change"));
    expect(settings.get(SEQUENCE_TIMEOUT)).toBe(1500);
  });
});

// #158 finding 19: 378 commands made a 36,000 px list with no index. It opens on the commands that
// have a shortcut, in groups by who provides them, with an index; a search looks in all of them.
describe("keyboard settings' list", () => {
  let keyboard: ReturnType<typeof mountKeyboard>;
  const commands = [
    { id: "desk.a.keyed", title: "Keyed", keywords: [], provider: "desk" },
    { id: "desk.a.bare", title: "Bare", keywords: [], provider: "desk" },
    { id: "endue.notes.new", title: "New note", keywords: [], provider: "endue.notes" },
    { id: "endue.git.pull", title: "Pull", keywords: [], provider: "endue.git" },
  ];

  beforeEach(() => {
    vi.stubGlobal("CSS", { escape: (value: string) => value });
    const settings = new Settings();
    keyboard = mountKeyboard({
      settings,
      commands: { list: () => commands, onChange: () => () => {} } as unknown as Commands,
      keymap: { onChange: () => () => {} } as unknown as Keymap,
      contributed: () => [
        { key: "Control+K", command: "desk.a.keyed", owner: "desk" },
        { key: "Control+Alt+N", command: "endue.notes.new", owner: "endue.notes" },
      ],
      platform: "other",
      language: "en",
      plugin: (id) => ({ "endue.notes": "Notes", "endue.git": "Git" })[id] ?? id,
    });
    document.body.append(keyboard.el);
  });

  afterEach(() => {
    keyboard.dispose();
    keyboard.el.remove();
    vi.unstubAllGlobals();
  });

  const shown = () =>
    [...keyboard.el.querySelectorAll<HTMLElement>("[data-command]")].map((r) => r.dataset.command);
  const headings = () =>
    [...keyboard.el.querySelectorAll(".settings-key-group h3")].map((h) => h.textContent);
  const views = () =>
    [...keyboard.el.querySelectorAll<HTMLButtonElement>(".keys-views-switch .segment")].map((b) => [
      b.textContent,
      b.getAttribute("aria-pressed"),
    ]);
  const click = (selector: string) =>
    keyboard.el.querySelector<HTMLButtonElement>(selector)?.click();

  it("opens on the commands with a shortcut, and shows every command on a switch", () => {
    expect(views()).toEqual([
      ["With a shortcut (2)", "true"],
      ["All commands (4)", "false"],
    ]);
    expect(shown()).toEqual(["desk.a.keyed", "endue.notes.new"]);
    expect(headings()).toEqual(["Desk", "Notes"]);
    click('[data-key="keys-view-all"]');
    expect(shown()).toEqual(["desk.a.keyed", "desk.a.bare", "endue.git.pull", "endue.notes.new"]);
    expect(headings()).toEqual(["Desk", "Git", "Notes"]);
  });

  it("keeps a row whose key was cleared, and a search looks in every command", () => {
    click('[data-key="keys-remove-desk.a.keyed"]');
    expect(shown()).toEqual(["desk.a.keyed", "endue.notes.new"]);
    const search = keyboard.el.querySelector<HTMLInputElement>('input[type="search"]');
    if (!search) throw new Error("Missing command search");
    search.value = "pull";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(shown()).toEqual(["endue.git.pull"]);
  });

  it("jumps to a group from the index and puts the caret in its own search", () => {
    const scrolled: string[] = [];
    // jsdom lays nothing out and has no scrollIntoView; this one records what a link scrolls to.
    const had = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.textContent ?? "");
    };
    onTestFinished(() => {
      Element.prototype.scrollIntoView = had;
    });
    const index = [...keyboard.el.querySelectorAll<HTMLButtonElement>(".settings-jump button")];
    expect(index.map((b) => b.textContent)).toEqual(["Desk", "Notes"]);
    index[1]?.click();
    expect(scrolled).toEqual(["Notes"]);
    expect(document.activeElement?.textContent).toBe("Notes");
    keyboard.focusSearch();
    expect(document.activeElement).toBe(keyboard.el.querySelector('input[type="search"]'));
  });
});
