// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { ManualClock } from "../clock";
import { ShortcutRouter } from "../input";
import { type KeyEntry, resolveBindings } from "./conflicts";
import { mountIndicator, OUTCOME_MS } from "./indicator";
import { mountWhichKey } from "./which-key";

const entries: KeyEntry[] = [
  { key: "Ctrl+C p f", command: "example.project.file", owner: "example.project" },
  { key: "Ctrl+C p s", command: "example.project.search", owner: "example.project" },
  { key: "Ctrl+C Ctrl+T", command: "desk.theme.toggle", owner: "person" },
];
const titles: Record<string, string> = {
  "example.project.file": "Find a file in the project",
  "example.project.search": "Search the project",
  "desk.theme.toggle": "Toggle theme",
};

function desk() {
  const root = document.createElement("div");
  const frame = document.createElement("button");
  frame.textContent = "a plugin frame";
  document.body.append(root, frame);
  const router = new ShortcutRouter({ platform: "other" });
  const ran: string[] = [];
  const { bindings } = resolveBindings(entries, "other");
  for (const b of bindings) router.bind(b.combo, () => ran.push(b.command));
  const clock = new ManualClock();
  const overlay = mountWhichKey({
    root,
    sequences: router.sequences,
    platform: "other",
    language: "en",
    bindings: () => bindings,
    facts: {
      title: (id) => titles[id],
      available: () => true,
      owner: (owner) => (owner === "person" ? "you" : owner),
    },
  });
  const indicator = mountIndicator({
    root,
    sequences: router.sequences,
    platform: "other",
    language: "en",
    clock,
  });
  const press = (key: string, ctrl = false) =>
    router.handle({ key, ctrlKey: ctrl, metaKey: false, altKey: false, shiftKey: false });
  const search = () => root.querySelector<HTMLInputElement>(".desk-which-key-search");
  const type = (key: string, ctrl = false) =>
    search()?.dispatchEvent(
      new KeyboardEvent("keydown", { key, ctrlKey: ctrl, bubbles: true, cancelable: true }),
    );
  const rows = () =>
    [...root.querySelectorAll(".desk-which-key-item")].map((li) =>
      [...li.querySelectorAll("span")].map((s) => s.textContent).slice(0, 3),
    );
  const dispose = () => {
    overlay.dispose();
    indicator.dispose();
    root.remove();
    frame.remove();
  };
  return { root, frame, router, ran, clock, press, search, type, rows, dispose };
}

let current: ReturnType<typeof desk> | undefined;
afterEach(() => current?.dispose());

describe("the which-key overlay", () => {
  it("lists every continuation after a prefix, takes the focus and gives it back", () => {
    const d = desk();
    current = d;
    d.frame.focus();
    d.press("c", true);
    expect(d.root.querySelector(".desk-which-key-title")?.textContent).toBe("Keys after Ctrl+C");
    expect(d.rows()).toEqual([
      ["Ctrl+T", "Toggle theme", "you"],
      ["PF", "Find a file in the project", "example.project"],
      ["PS", "Search the project", "example.project"],
    ]);
    expect(document.activeElement).toBe(d.search());
    expect(d.root.querySelector(".desk-keys-pending")?.textContent).toContain("Ctrl+C");
    // A plain key typed in the overlay is the next chord: the frame would have kept it.
    d.type("p");
    expect(d.rows().map((r) => r[0])).toEqual(["F", "S"]);
    d.type("f");
    expect(d.ran).toEqual(["example.project.file"]);
    expect(d.root.querySelector(".desk-which-key")).toBeNull();
    expect(d.root.querySelector(".desk-keys-pending")).toBeNull();
    expect(document.activeElement).toBe(d.frame);
  });

  it("searches, moves with the arrows, runs with Enter, and cancels with Escape or Ctrl+G", () => {
    const d = desk();
    current = d;
    d.press("c", true);
    const search = d.search();
    if (!search) throw new Error("no overlay");
    // A key that continues nothing starts a search instead.
    d.type("z");
    expect(d.router.sequences.pending).toEqual(["Control+C"]);
    search.value = "project";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(d.rows().map((r) => r[1])).toEqual(["Find a file in the project", "Search the project"]);
    d.type("ArrowDown");
    expect(search.getAttribute("aria-activedescendant")).toBe("desk-which-key-1");
    d.type("Enter");
    expect(d.ran).toEqual(["example.project.search"]);

    d.press("c", true);
    d.type("Escape");
    expect(d.router.sequences.pending).toEqual([]);
    expect(d.root.querySelector(".desk-keys-pending")?.textContent).toBe("Quit");
    d.clock.advance(OUTCOME_MS);
    expect(d.root.querySelector(".desk-keys-pending")).toBeNull();
    d.press("c", true);
    d.type("g", true);
    expect(d.root.querySelector(".desk-which-key")).toBeNull();
    expect(d.ran).toEqual(["example.project.search"]);
  });

  it("says an unbound continuation in the status area for a moment", () => {
    const d = desk();
    current = d;
    d.press("c", true);
    d.type("q", true);
    expect(d.root.querySelector(".desk-keys-pending")?.textContent).toBe(
      "Ctrl+C Ctrl+Q is not bound",
    );
    d.clock.advance(OUTCOME_MS);
    expect(d.root.querySelector(".desk-keys-pending")).toBeNull();
  });
});
