// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { ManualClock } from "../clock";
import type { CommandSpec } from "../commands";
import { DEFAULT_KEYS } from "../core/keys";
import { listenForShortcuts, ShortcutRouter } from "../input";
import { Keymap } from "../keymap";
import { Settings } from "../settings";
import { mountComposer } from "./Composer";
import type { ShellCtx } from "./context";
import { t } from "./copy";
import { emptyState, Store } from "./state";
import { mountTalkChrome } from "./TalkChrome";
import { Ticker } from "./ticker";

const cleanups: (() => void)[] = [];
function get<T extends HTMLElement>(root: HTMLElement, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Missing ${selector}`);
  return el;
}
afterEach(() => {
  for (const off of cleanups.splice(0)) off();
  document.body.replaceChildren();
});
function setup() {
  const root = document.createElement("footer");
  document.body.append(root);
  const clock = new ManualClock();
  const ticker = new Ticker(clock);
  const store = new Store(emptyState("en"));
  const defined = new Map<string, CommandSpec>();
  const commands = {
    list: () => [],
    has: (id: string) => defined.has(id),
    define: (id: string, spec: CommandSpec) => {
      defined.set(id, spec);
      return () => defined.delete(id);
    },
    run: (id: string) => Promise.resolve(defined.get(id)?.run(undefined, {})),
  };
  const shortcuts = new ShortcutRouter({ platform: "mac" });
  const keymap = new Keymap(shortcuts, commands as never);
  keymap.apply(DEFAULT_KEYS);
  cleanups.push(listenForShortcuts(window, shortcuts));
  const ctx = {
    store,
    ticker,
    reduced: () => false,
    platform: "mac",
    keyOf: (id: string) => keymap.keysFor(id)[0],
    tr: (key: Parameters<typeof t>[1]) => t("en", key),
    runtime: {
      commands,
      settings: new Settings(),
      shortcuts,
      keymap,
      focusSurface: () => {},
    },
    bridge: { agents: { card: async () => ({}) } },
  } as unknown as ShellCtx;
  cleanups.push(mountComposer(root, ctx), mountTalkChrome(root, ctx), () => ticker.dispose());
  return { root, store, clock, keymap, shortcuts, input: get<HTMLInputElement>(root, "input") };
}
it("previews on hover without stealing focus, opens on click, and folds on Escape", () => {
  const { root, input } = setup();
  const pill = get(root, ".composer");
  const launch = get<HTMLButtonElement>(root, ".talk-launch");
  expect(launch.textContent).toContain("Talk to Eris");
  expect(pill.dataset.state).toBe("idle");
  pill.dispatchEvent(new Event("pointerenter"));
  expect(pill.dataset.state).toBe("hover");
  expect(document.activeElement).not.toBe(input);
  launch.click();
  expect(document.activeElement).toBe(input);
  expect(pill.dataset.state).toBe("edit");
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  pill.dispatchEvent(new Event("pointerleave"));
  expect(pill.dataset.state).toBe("idle");
});
it("opens with the displayed Option-Space shortcut and retains existing input text", () => {
  const { root, input, store } = setup();
  expect(root.querySelector(".talk-shortcut")?.textContent).toContain("⌥Space");
  window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", altKey: true, bubbles: true }));
  expect(document.activeElement).toBe(input);
  input.value = "한글 draft";
  input.dispatchEvent(new Event("input"));
  expect(store.get().composer.text).toBe("한글 draft");
  root.querySelector(".composer")?.dispatchEvent(new Event("pointerleave"));
  expect(input.value).toBe("한글 draft");
});
it("shows directory agents and closes its picker on Escape without submitting", () => {
  const { root, store } = setup();
  store.set({
    agents: [{ id: "mira", name: "Mira", slug: "mira", status: "active" } as never],
    spaceAgents: ["mira"],
  });
  root.querySelector<HTMLButtonElement>(".talk-launch")?.click();
  root.querySelector<HTMLButtonElement>(".talk-agent-button")?.click();
  const picker = get(root, ".talk-agent-list");
  expect(picker.hidden).toBe(false);
  expect(picker.textContent).toContain("Mira");
  picker.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(picker.hidden).toBe(true);
});
it("opens the selected agent's existing screen and returns focus to the talk line", () => {
  const { root, store, input } = setup();
  store.set({
    agents: [{ id: "mira", name: "Mira", slug: "mira", status: "active" } as never],
    spaceAgents: ["mira"],
  });
  get<HTMLButtonElement>(root, ".talk-launch").click();
  get<HTMLButtonElement>(root, ".talk-agent-button").click();
  get<HTMLButtonElement>(root, ".talk-agent-list button").click();
  expect(store.get().agentId).toBe("mira");
  expect(store.get().focused).toBe("agent:mira");
  expect(document.activeElement).toBe(input);
});
it("opens from a plugin's forwarded shortcut and honors a personal replacement binding", () => {
  const { root, input, shortcuts, keymap } = setup();
  keymap.apply([{ key: "Alt+Enter", command: "desk.shell.talk", owner: "person" }]);
  expect(root.querySelector(".talk-shortcut")?.textContent).toBe("⌥↩");
  shortcuts.focus("test.plugin");
  expect(
    shortcuts.handle({ key: " ", altKey: true, metaKey: false, ctrlKey: false, shiftKey: false }),
  ).toBe(false);
  expect(
    shortcuts.handle({
      key: "Enter",
      altKey: true,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
    }),
  ).toBe(true);
  expect(document.activeElement).toBe(input);
});
