// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { filter, remember } from "../ui/match.js";
import { actionOf, createAsker, rows, searchItems } from "../ui/providers.js";
import { createSearch, openSearchHit, searchEntry } from "../ui/search.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function mount(
  provider?: Promise<unknown>,
  pluginSearch?: (query: string) => Promise<{ hits: unknown[] }>,
) {
  vi.useFakeTimers();
  document.body.innerHTML = `<div data-testid="scrim"></div><div data-testid="title"></div>
    <input data-testid="query"><ul data-testid="results"></ul>
    <div data-testid="actions"></div><div data-testid="status"></div>`;
  const plugins = deferred<{ hits: unknown[] }>();
  const system = deferred<{ hits: unknown[] }>();
  const callbacks = new Map<string, (args?: unknown) => Promise<unknown>>();
  const run = vi.fn(async (id: string) => {
    if (id === "desk.keys.list") return [];
    if (id === "desk.palette.providers")
      return provider ? [{ command: "example.provider.search", title: "Provider" }] : [];
    if (id === "example.provider.search") return provider;
    return undefined;
  });
  const ctx = {
    pluginId: "desk.palette",
    bridge: {
      call: vi.fn((method: string, params?: { query?: string }) => {
        if (method === "search.query")
          return pluginSearch?.(params?.query ?? "") ?? plugins.promise;
        if (method === "search.system") return system.promise;
        if (method === "init.get") return Promise.resolve({ settings: {} });
        return Promise.resolve({});
      }),
    },
    commands: {
      list: async () => [
        { id: "example.alpha", title: "Terminal alpha" },
        { id: "example.bravo", title: "Terminal bravo" },
      ],
      on: (id: string, handler: (args?: unknown) => Promise<unknown>) => callbacks.set(id, handler),
      run,
    },
    data: { query: vi.fn() },
    surface: { show: vi.fn(), hide: vi.fn() },
  };
  // The plugin imports the SDK through a browser import map, so supply its entry points here.
  const source = readFileSync(join(import.meta.dirname, "../ui/main.js"), "utf8").replace(
    /^import .*;\n/gm,
    "",
  );
  let registered: { mount: (context: unknown) => Promise<void> } | undefined;
  const define = (definition: { mount: (context: unknown) => Promise<void> }) => {
    registered = definition;
  };
  const load = new Function(
    "CommandFailed",
    "defineUiPlugin",
    "filter",
    "remember",
    "actionOf",
    "createAsker",
    "rows",
    "searchItems",
    "createSearch",
    "openSearchHit",
    "searchEntry",
    source,
  );
  load(
    Error,
    define,
    filter,
    remember,
    actionOf,
    createAsker,
    rows,
    searchItems,
    createSearch,
    openSearchHit,
    searchEntry,
  );
  if (!registered) throw new Error("palette did not register");
  await registered.mount(ctx);
  await callbacks.get("desk.palette.open")?.({});
  const input = document.querySelector<HTMLInputElement>('[data-testid="query"]');
  const list = document.querySelector<HTMLUListElement>('[data-testid="results"]');
  if (!input || !list) throw new Error("palette elements missing");
  const type = (value: string) => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const key = (name: string) => input.dispatchEvent(new KeyboardEvent("keydown", { key: name }));
  const selected = () => document.getElementById(input.getAttribute("aria-activedescendant") ?? "");
  return { input, list, plugins, system, run, type, key, selected };
}

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
      hits: [{ id: "plugin-result", kind: "plugin", title: "Terminal plugin", plugin: "terminal" }],
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
    const palette = await mount(provider.promise);
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
    const palette = await mount(undefined, (query) =>
      query === "oldquery" ? old.promise : current.promise,
    );
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
});
