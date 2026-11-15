// @vitest-environment jsdom
// Settings › Keyboard's row for the key that opens Search Desk from any app (#304): the runtime's
// own core setting `palette.shortcut` (the person's `desk.palette.shortcut`), recorded as any other
// key and saved in the shell's shortcut syntax, which the shell follows without a restart. The row
// shows the key the shell says it holds (`palette.shortcut.held`), not the one saved: a key another
// app holds is said in words. A key Eris holds is refused in words; one the desk binds is saved,
// saying the desk gives it up.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Resolved } from "../sequences/conflicts";
import { formatSequence } from "../sequences/parse";
import { Settings } from "../settings";
import { ANSWER_MS, CORE_KEY, globalKeyRow, HELD_KEY, toAccelerator, toChord } from "./global-key";

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

const flush = () => new Promise((done) => setTimeout(done, 0));

function mount(options: { held?: string; eris?: string; bindings?: Partial<Resolved>[] } = {}) {
  const settings = new Settings();
  if (options.eris) settings.set("endue.eris.shortcut", options.eris);
  const call = vi.fn(async (method: string, params?: unknown) => {
    const key = (params as { key?: string } | undefined)?.key;
    if (method !== "settings.get") return {};
    return key === CORE_KEY && options.held ? { value: options.held } : {};
  });
  const listeners: ((event: { event: string; data?: unknown }) => void)[] = [];
  /** The shell's answer: the key it holds, and the one it refused. */
  const answer = (value: unknown) => {
    for (const listener of listeners)
      listener({ event: "settings.changed", data: { owner: "desk", key: HELD_KEY, value } });
  };
  const row = globalKeyRow({
    bridge: {
      call,
      onEvent: (listener) => {
        listeners.push(listener);
        return () => {};
      },
    },
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
  return { row, call, press, shown, note, answer };
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
    const { call, press, shown, note, answer } = mount();
    await flush();
    expect(call).toHaveBeenCalledWith("settings.get", { key: CORE_KEY });
    expect(shown()).toBe(formatSequence("Meta+Shift+Space", "mac"));
    press({ key: "k", code: "KeyK", metaKey: true, altKey: true });
    await flush();
    expect(call).toHaveBeenCalledWith("settings.set", {
      key: CORE_KEY,
      value: "CommandOrControl+Alt+KeyK",
    });
    // Saved, not held yet: the shell says when it has the key.
    expect(shown()).toBe(formatSequence("Meta+Shift+Space", "mac"));
    expect(note()).toMatch(/^Taking /);
    answer({ shortcut: "CommandOrControl+Alt+KeyK", refused: null });
    expect(shown()).toBe(formatSequence("Meta+Alt+K", "mac"));
    expect(note()).toBe("");
  });

  it("a key the shell cannot have is said in words, and the key held before stays", async () => {
    const { press, shown, note, answer } = mount();
    await flush();
    press({ key: "k", code: "KeyK", metaKey: true, altKey: true });
    await flush();
    answer({
      shortcut: "CommandOrControl+Shift+Space",
      refused: { shortcut: "CommandOrControl+Alt+KeyK", why: "another app holds it" },
    });
    expect(shown()).toBe(formatSequence("Meta+Shift+Space", "mac"));
    expect(note()).toBe(
      `${formatSequence("Meta+Alt+K", "mac")} can't be used: another app holds it. The key held before stays.`,
    );
  });

  it("says in words when DESK_PALETTE_SHORTCUT sets the key, and a recorded key is kept", async () => {
    const { press, shown, row, answer, call } = mount();
    await flush();
    const env = () => row.el.querySelector<HTMLElement>(".settings-key-env");
    expect(env()?.hidden).toBe(true);
    answer({ shortcut: "Alt+Space", refused: null, env: true });
    expect(shown()).toBe(formatSequence("Alt+Space", "mac"));
    expect(env()?.hidden).toBe(false);
    expect(env()?.textContent).toMatch(/DESK_PALETTE_SHORTCUT sets this key/);
    // Recorded anyway: saved for a desk without the variable; the shell still holds the env's.
    press({ key: "k", code: "KeyK", metaKey: true, altKey: true });
    await flush();
    expect(call).toHaveBeenCalledWith("settings.set", {
      key: CORE_KEY,
      value: "CommandOrControl+Alt+KeyK",
    });
    answer({ shortcut: "Alt+Space", refused: null, env: true });
    expect(shown()).toBe(formatSequence("Alt+Space", "mac"));
    expect(env()?.hidden).toBe(false);
  });

  it("without a shell to answer, the key saved shows after a moment", async () => {
    vi.useFakeTimers();
    const { press, shown, note } = mount();
    await vi.advanceTimersByTimeAsync(0);
    press({ key: "k", code: "KeyK", metaKey: true, altKey: true });
    await vi.advanceTimersByTimeAsync(ANSWER_MS - 1);
    expect(shown()).toBe(formatSequence("Meta+Shift+Space", "mac"));
    await vi.advanceTimersByTimeAsync(1);
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
    desk.answer({ shortcut: "CommandOrControl+Alt+KeyK", refused: null });
    expect(desk.note()).toMatch(/“New note”/);
  });
});
