// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { type KeyEntry, resolveBindings } from "../sequences/conflicts";
import { type ConflictWords, conflictsPanel } from "./key-conflicts";

// Settings › Keyboard's conflicts in a person's words (#158 finding 16): no file path, no id.
const titles: Record<string, string> = {
  "desk.shell.move-to-desktop-3": "Window · To desktop 3",
  "example.a.open": "Open the list",
  "example.b.new": "New item",
  "desk.palette.open": "Search Desk",
};
const words = (language: "en" | "ko" = "en"): ConflictWords => ({
  platform: "mac",
  language,
  title: (id) => titles[id],
  plugin: (id) => ({ "desk.shell": "Shell", "example.a": "List", "example.b": "Items" })[id] ?? id,
});
const source = {
  file: "/Users/someone/desk/plugins/shell/plugin.json",
  path: "contributes.keys[11]",
};
const panel = (entries: KeyEntry[], language: "en" | "ko" = "en") =>
  conflictsPanel(resolveBindings(entries, "mac").conflicts, words(language));
const rows = (el: HTMLElement | null) =>
  [...(el?.querySelectorAll<HTMLElement>(".keys-conflict") ?? [])].map((row) => ({
    title: row.querySelector("strong")?.textContent,
    why: row.querySelector(".keys-conflict-why")?.textContent,
    who: row.querySelector("small")?.textContent,
    keys: [...row.querySelectorAll("kbd")].map((k) => k.textContent),
  }));

describe("the conflicts panel", () => {
  it("says what macOS does with a key, who set it, and what to do; never a path", () => {
    const el = panel([
      { key: "Mod+Shift+3", command: "desk.shell.move-to-desktop-3", owner: "desk.shell", source },
      { key: "Mod+Shift+5", command: "desk.shell.move-to-desktop-5", owner: "desk.shell", source },
    ]);
    expect(el?.querySelector("h2")?.textContent).toBe("Shortcut conflicts (2)");
    expect(rows(el)).toEqual([
      {
        title: "Window · To desktop 3",
        why: "macOS uses this key: it takes a screenshot. Turn that shortcut off in the system's settings, or give this command another key.",
        who: "Set by Shell",
        keys: ["⇧⌘3"],
      },
      {
        title: "A command not available now",
        why: "macOS uses this key: it takes a screenshot. Turn that shortcut off in the system's settings, or give this command another key.",
        who: "Set by Shell",
        keys: ["⇧⌘5"],
      },
    ]);
    expect(el?.textContent).not.toMatch(/plugin\.json|contributes|\/Users|desk\.shell\./);
  });

  it("words a key two plugins give, a key a longer one starts with, and one a person took over", () => {
    const el = panel([
      { key: "Mod+J", command: "example.a.open", owner: "example.a" },
      { key: "Mod+J", command: "example.b.new", owner: "example.b" },
      { key: "Mod+L", command: "example.a.open", owner: "example.a" },
      { key: "Mod+L Mod+N", command: "example.b.new", owner: "example.b" },
      { key: "Mod+K", command: "example.a.open", owner: "desk" },
      { key: "Mod+K", command: "desk.palette.open", owner: "person" },
    ]);
    const [twice, prefix] = rows(el);
    expect(twice).toEqual({
      title: "Open the list",
      why: "“New item” has this key too and runs instead (set by Items).",
      who: "Set by List",
      keys: ["⌘J"],
    });
    expect(prefix?.why).toBe(
      "⌘L ⌘N starts with this key, so pressing it only waits for the next key.",
    );
    const taken = el?.querySelector("details");
    expect(taken?.querySelector("summary")?.textContent).toBe("Taken over by another shortcut (1)");
    expect(rows(taken as HTMLElement)[0]).toMatchObject({
      title: "Open the list",
      why: "“Search Desk” has this key too and runs instead (set by you).",
      who: "Built in",
    });
  });

  it("shows nothing for a key two layers give the same command, and speaks Korean", () => {
    expect(
      panel([
        { key: "Control+1", command: "example.a.open", owner: "desk" },
        { key: "Control+1", command: "example.a.open", owner: "example.a" },
      ]),
    ).toBeNull();
    const el = panel(
      [{ key: "Mod+Shift+4", command: "desk.shell.move-to-desktop-3", owner: "desk.shell" }],
      "ko",
    );
    expect(rows(el)[0]).toMatchObject({
      why: "macOS가 이 키로 스크린샷을 찍습니다. 시스템 설정에서 그 단축키를 끄거나 이 명령에 다른 키를 지정하세요.",
      who: "플러그인: Shell",
    });
  });
});
