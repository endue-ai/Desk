// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Commands } from "../commands";
import { PERSONAL_KEYS } from "../core/defaults";
import type { Keymap } from "../keymap";
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
      platform: "linux",
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
});
