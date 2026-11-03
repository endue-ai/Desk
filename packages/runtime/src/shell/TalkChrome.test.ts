// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { ManualClock } from "../clock";
import { Settings } from "../settings";
import { mountComposer } from "./Composer";
import type { ShellCtx } from "./context";
import { t } from "./copy";
import { emptyState, Store } from "./state";
import { mountTalkChrome } from "./TalkChrome";
import { Ticker } from "./ticker";

const cleanups: (() => void)[] = [];
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
  const ctx = {
    store, ticker, reduced: () => false, platform: "mac", keyOf: () => undefined,
    tr: (key: Parameters<typeof t>[1]) => t("en", key),
    runtime: { commands: { list: () => [], has: () => false }, settings: new Settings() },
  } as unknown as ShellCtx;
  cleanups.push(mountComposer(root, ctx), mountTalkChrome(root, ctx), () => ticker.dispose());
  return { root, store, clock, input: root.querySelector<HTMLInputElement>("input")! };
}
it("previews on hover without stealing focus, opens on click, and folds on Escape", () => {
  const { root, input } = setup();
  const pill = root.querySelector<HTMLElement>(".composer")!;
  const launch = root.querySelector<HTMLButtonElement>(".talk-launch")!;
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
  store.set({ agents: [{ id: "mira", name: "Mira", slug: "mira", status: "active" } as never], spaceAgents: ["mira"] });
  root.querySelector<HTMLButtonElement>(".talk-launch")?.click();
  root.querySelector<HTMLButtonElement>(".talk-agent-button")?.click();
  const picker = root.querySelector<HTMLElement>(".talk-agent-list")!;
  expect(picker.hidden).toBe(false);
  expect(picker.textContent).toContain("Mira");
  picker.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(picker.hidden).toBe(true);
});
