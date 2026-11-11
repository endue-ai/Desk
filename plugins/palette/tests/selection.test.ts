// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { deferred, mount } from "./harness";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("palette selection while search is pending", () => {
  it("keeps the chosen command and runs it when plugin hits arrive ahead of it", async () => {
    const palette = await mount();
    palette.type("term");
    palette.key("ArrowDown");
    expect(palette.selected()?.dataset.id).toBe("example.bravo");
    await vi.advanceTimersByTimeAsync(120);
    palette.plugins.resolve({
      hits: [{ id: "plugin-result", kind: "plugin", title: "Terminal", plugin: "terminal" }],
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(palette.selected()?.dataset.id).toBe("example.bravo");
    expect(palette.selected()?.getAttribute("aria-selected")).toBe("true");
    palette.key("Enter");
    await vi.advanceTimersByTimeAsync(0);
    expect(palette.run).toHaveBeenCalledWith("example.bravo", {});
  });

  it("selects the first row when the typed text changes", async () => {
    const palette = await mount();
    palette.type("term");
    palette.key("ArrowDown");
    expect(palette.selected()?.dataset.id).toBe("example.bravo");
    palette.type("termi");
    expect(palette.selected()?.dataset.id).toBe("example.alpha");
  });

  it("does not confuse a search hit with a command that has the same id", async () => {
    const palette = await mount();
    palette.type("term");
    expect(palette.selected()?.textContent).toContain("Terminal alpha");
    await vi.advanceTimersByTimeAsync(120);
    palette.plugins.resolve({
      hits: [{ id: "example.alpha", kind: "plugin", title: "A different result", plugin: "x" }],
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(palette.selected()?.textContent).toContain("Terminal alpha");
    palette.key("Enter");
    await vi.advanceTimersByTimeAsync(0);
    expect(palette.run).toHaveBeenCalledWith("example.alpha", {});
  });

  it("selects the first remaining row if the selected search hit disappears", async () => {
    const palette = await mount();
    palette.type("term");
    await vi.advanceTimersByTimeAsync(120);
    palette.plugins.resolve({
      hits: [{ id: "plugin-result", kind: "plugin", title: "Terminal plugin", plugin: "x" }],
    });
    await vi.advanceTimersByTimeAsync(0);
    palette.key("ArrowUp");
    expect(palette.selected()?.dataset.id).toBe("plugin-result");
    palette.type("term");
    expect(palette.selected()?.dataset.id).toBe("example.alpha");
  });

  it("reports searching until both searches have settled, then no match", async () => {
    const palette = await mount();
    palette.type("nothingmatches");
    const empty = () => palette.list.querySelector(".empty");
    expect(empty()?.textContent).toBe("Searching…");
    expect(empty()?.getAttribute("role")).toBe("option");
    expect(empty()?.getAttribute("aria-disabled")).toBe("true");
    await vi.advanceTimersByTimeAsync(120);
    palette.plugins.resolve({ hits: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(empty()?.textContent).toBe("Searching…");
    palette.system.resolve({ hits: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(empty()?.textContent).toBe("No match");
  });

  it("waits for a provider that rejects after the two bridge searches finish", async () => {
    const provider = deferred<unknown>();
    const palette = await mount({ provider: provider.promise });
    palette.type("nothingmatches");
    await vi.advanceTimersByTimeAsync(120);
    palette.plugins.resolve({ hits: [] });
    palette.system.resolve({ hits: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(palette.list.querySelector(".empty")?.textContent).toBe("Searching…");
    provider.reject(new Error("provider unavailable"));
    await vi.advanceTimersByTimeAsync(0);
    expect(palette.list.querySelector(".empty")?.textContent).toBe("No match");
  });

  it("does not let a stale search settle or replace the current query", async () => {
    const old = deferred<{ hits: unknown[] }>();
    const current = deferred<{ hits: unknown[] }>();
    const palette = await mount({
      pluginSearch: (query) => (query === "oldquery" ? old.promise : current.promise),
    });
    palette.type("oldquery");
    await vi.advanceTimersByTimeAsync(120);
    palette.type("nothingmatches");
    await vi.advanceTimersByTimeAsync(120);
    palette.system.resolve({ hits: [] });
    old.resolve({ hits: [{ id: "old", kind: "plugin", title: "Old result", plugin: "x" }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(palette.list.textContent).not.toContain("Old result");
    expect(palette.list.querySelector(".empty")?.textContent).toBe("Searching…");
    current.resolve({ hits: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(palette.list.querySelector(".empty")?.textContent).toBe("No match");
  });
  it("restarts cancelled searches when the palette becomes visible again", async () => {
    const old = deferred<{ hits: unknown[] }>();
    const current = deferred<{ hits: unknown[] }>();
    const provider = deferred<unknown>();
    let requests = 0;
    const palette = await mount({
      provider: provider.promise,
      pluginSearch: () => (++requests === 1 ? old.promise : current.promise),
    });
    palette.type("nothingmatches");
    await vi.advanceTimersByTimeAsync(120);
    palette.system.resolve({ hits: [] });
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(120);
    expect(requests).toBe(2);
    expect(palette.run.mock.calls.filter(([id]) => id === "example.provider.search")).toHaveLength(
      2,
    );
    old.resolve({ hits: [{ id: "old", kind: "plugin", title: "Old", plugin: "x" }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(palette.list.textContent).not.toContain("Old");
    expect(palette.list.querySelector(".empty")?.textContent).toBe("Searching…");
    current.resolve({ hits: [] });
    provider.resolve({ results: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(palette.list.querySelector(".empty")?.textContent).toBe("No match");
    delete (document as unknown as { hidden?: boolean }).hidden;
  });
});

describe("palette key hints", () => {
  it("shows a key sequence chord by chord, one <kbd> per chord, and keys a comma apart", async () => {
    const palette = await mount({
      bindings: [
        { key: "⌘K ⌘S", combo: "Meta+K Meta+S", command: "example.alpha", owner: "person" },
        { key: "⌃C P F", combo: "Control+C P F", command: "example.alpha", owner: "person" },
      ],
    });
    palette.type("alpha");
    const hint = palette.list.querySelector('[data-id="example.alpha"] .keys');
    expect([...(hint?.querySelectorAll("kbd") ?? [])].map((kbd) => kbd.textContent)).toEqual([
      "⌘K",
      "⌘S",
      "⌃C",
      "P",
      "F",
    ]);
    expect(hint?.textContent).toBe("⌘K ⌘S, ⌃C P F");
  });
});

describe("palette picks", () => {
  it("a pick starts from its query and answers the edited text", async () => {
    const palette = await mount();
    const pick = palette.callbacks.get("desk.palette.pick");
    const answer = pick?.({ title: "Rename a2.md", items: [], free: true, query: "a2.md" });
    expect(palette.input.value).toBe("a2.md");
    expect(palette.selected()?.dataset.id).toBe("a2.md");
    palette.type("notes.md");
    palette.key("Enter");
    await expect(answer).resolves.toBe("notes.md");
  });

  it("a question that takes typed text says nothing under its empty field, then offers the text", async () => {
    const palette = await mount();
    const pick = palette.callbacks.get("desk.palette.pick");
    void pick?.({ title: "Add a folder", items: [], free: true, placeholder: "~/path" });
    expect(palette.list.textContent).toBe("");
    palette.type("~/Projects");
    expect(palette.list.textContent).toContain("Use “~/Projects”");
    // A question with answers to pick from still says when the text matches none of them.
    void pick?.({ title: "Pick one", items: [{ id: "a", label: "Alpha" }] });
    palette.type("zzz");
    expect(palette.list.querySelector(".empty")?.textContent).toBe("No match");
  });
});
