// @vitest-environment jsdom
// Settings › Keyboard's row for the key that opens Search Desk from any app (#304): the runtime's
// own core setting `palette.shortcut` (the person's `desk.palette.shortcut`), recorded as any other
// key and saved in the shell's shortcut syntax, which the shell follows without a restart. A key
// Eris holds is refused in words; one the desk binds is saved, saying the desk gives it up.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Resolved } from "../sequences/conflicts";
import { formatSequence } from "../sequences/parse";
import { Settings } from "../settings";
import { CORE_KEY, globalKeyRow, toAccelerator, toChord } from "./global-key";

afterEach(() => {
  document.body.replaceChildren();
});

const flush = () => new Promise((done) => setTimeout(done, 0));

function mount(options: { held?: string; eris?: string; bindings?: Partial<Resolved>[] } = {}) {
  const settings = new Settings();
  if (options.eris) settings.set("endue.eris.shortcut", options.eris);
  const call = vi.fn(async (method: string, _params?: unknown) =>
    method === "settings.get" ? (options.held ? { value: options.held } : {}) : {},
  );
  const row = globalKeyRow({
    bridge: { call },
    settings,
    platform: "mac",
    language: "en",
    bindings: () => (options.bindings ?? []) as Resolved[],
    title: (id) => (id === "endue.notes.new" ? "New note" : undefined),
  });
  document.body.append(row.el);
  const press = (init: KeyboardEventInit) => {
    row.el.querySelector<HTMLButtonElement>('[data-key="record-palette-shortcut"]')?.click();
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
  };
  const shown = () => row.el.querySelector(".keys")?.textContent;
  const note = () => row.el.querySelector('[role="status"]')?.textContent ?? "";
  return { row, call, press, shown, note };
}

describe("the palette's global key", () => {
  it("reads as the shell writes it, and back", () => {
    expect(toChord("CommandOrControl+Shift+Space", "mac")).toBe("Meta+Shift+Space");
    expect(toChord("CommandOrControl+Shift+Space", "other")).toBe("Control+Shift+Space");
    expect(toChord("Alt+Enter", "mac")).toBe("Alt+Enter");
    expect(toChord("Control+Alt+KeyE", "mac")).toBe("Control+Alt+E");
    expect(toChord("Super+Shift+Digit1", "other")).toBe("Meta+Shift+1");
    expect(toAccelerator("Meta+Shift+Space", "mac")).toBe("CommandOrControl+Shift+Space");
    expect(toAccelerator("Control+Alt+K", "other")).toBe("CommandOrControl+Alt+KeyK");
    expect(toAccelerator("Meta+/", "mac")).toBe("CommandOrControl+Slash");
    expect(toChord(toAccelerator("Meta+Alt+F5", "mac"), "mac")).toBe("Meta+Alt+F5");
  });

  it("Settings › Keyboard has a row for the palette's global key", async () => {
    const { call, press, shown, note } = mount();
    await flush();
    expect(call).toHaveBeenCalledWith("settings.get", { key: CORE_KEY });
    expect(shown()).toBe(formatSequence("Meta+Shift+Space", "mac"));
    press({ key: "k", code: "KeyK", metaKey: true, altKey: true });
    await flush();
    expect(call).toHaveBeenCalledWith("settings.set", {
      key: CORE_KEY,
      value: "CommandOrControl+Alt+KeyK",
    });
    expect(shown()).toBe(formatSequence("Meta+Alt+K", "mac"));
    expect(note()).toBe("");
  });

  it("shows the key in force", async () => {
    const { shown } = mount({ held: "Control+Alt+KeyE" });
    await flush();
    expect(shown()).toBe(formatSequence("Control+Alt+E", "mac"));
  });

  it("a global key that conflicts is said in plain words", async () => {
    const eris = mount({ eris: "Alt+Enter" });
    await flush();
    eris.press({ key: "Enter", code: "Enter", altKey: true });
    await flush();
    expect(eris.note()).toMatch(/summons Eris/);
    expect(eris.call).not.toHaveBeenCalledWith("settings.set", expect.anything());

    const desk = mount({
      bindings: [{ command: "endue.notes.new", combo: "Meta+Alt+K", chords: ["Meta+Alt+K"] }],
    });
    await flush();
    desk.press({ key: "k", code: "KeyK", metaKey: true, altKey: true });
    await flush();
    expect(desk.call).toHaveBeenCalledWith("settings.set", {
      key: CORE_KEY,
      value: "CommandOrControl+Alt+KeyK",
    });
    expect(desk.note()).toMatch(/“New note”/);
  });
});
