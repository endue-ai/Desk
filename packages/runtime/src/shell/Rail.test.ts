// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrainStatus } from "../bridge/types";
import type { ShellCtx } from "./context";
import { mountRail } from "./Rail";
import { type DeskState, emptyState, Store, sampleState } from "./state";

/** The runtime as the rail reads it: a keymap that binds Tile, and the commands it runs. */
const runtimeOf = (run = vi.fn(async () => undefined)) => ({
  keymap: {
    onChange: () => () => {},
    bindings: () => [{ command: "desk.windows.tile", combo: "Meta+Alt+G" }],
  },
  commands: { run },
});
const keyOf = (command: string) => (command === "desk.windows.tile" ? "⌥⌘G" : "");

describe("the brain popover (ADR 0094)", () => {
  let root: HTMLDivElement;
  let store: Store;
  let dispose: () => void;
  const use = vi.fn();

  beforeEach(() => {
    use.mockReset();
    store = new Store(sampleState("en", 0));
    store.set({ brain: { mode: "cloud", credits: 0, brain: "endue" }, popover: "brain" });
    root = document.createElement("div");
    document.body.append(root);
    const ctx = {
      store,
      bridge: { brain: { use } },
      runtime: runtimeOf(),
      keyOf,
      tr: (key: string, vars?: Record<string, unknown>) =>
        vars ? `${key} ${JSON.stringify(vars)}` : key,
    } as unknown as ShellCtx;
    dispose = mountRail(root, ctx);
  });

  afterEach(() => {
    dispose();
    root.remove();
  });

  const segments = () =>
    [...root.querySelectorAll<HTMLButtonElement>("[data-popover=brain] [role=radio]")].map((b) => [
      b.dataset.key,
      b.getAttribute("aria-checked"),
    ]);

  it("offers endue AI, Claude Code, local and echo and marks the brain the desk chose", () => {
    expect(segments()).toEqual([
      ["brain-endue", "true"],
      ["brain-claude", "false"],
      ["brain-local", "false"],
      ["brain-echo", "false"],
    ]);
  });

  it("chooses the person's Claude Code (ADR 0109)", async () => {
    const claude: BrainStatus = { mode: "cloud", credits: 0, brain: "claude" };
    use.mockResolvedValue(claude);
    root.querySelector<HTMLButtonElement>("[data-key=brain-claude]")?.click();
    await vi.waitFor(() => expect(store.get().brain).toEqual(claude));
    expect(use).toHaveBeenCalledWith("claude");
    expect(segments()[1]).toEqual(["brain-claude", "true"]);
    const item = root.querySelector('[data-rail="brain"]');
    await vi.waitFor(() => expect(item?.getAttribute("aria-label")).toBe("brainClaude"));
  });

  it("switches through bridge.brain.use and shows what the desk answers", async () => {
    const local: BrainStatus = { mode: "local", model: "llama3.2", brain: "local" };
    use.mockResolvedValue(local);
    root.querySelector<HTMLButtonElement>("[data-key=brain-local]")?.click();
    await vi.waitFor(() => expect(store.get().brain).toEqual(local));
    expect(use).toHaveBeenCalledWith("local");
    expect(segments()[2]).toEqual(["brain-local", "true"]);
  });

  it("keeps the chosen brain marked while the local brain stands in for it", () => {
    store.set({ brain: { mode: "local", model: "llama3.2", brain: "echo", fallback: true } });
    expect(segments()[3]).toEqual(["brain-echo", "true"]);
    const note = root.querySelector("[data-popover=brain] .brain-fallback");
    expect(note?.textContent).toBe("brainFallback");
  });
});

describe("the other desks (#158 finding 8)", () => {
  let root: HTMLDivElement;
  let store: Store;
  let dispose: () => void;

  const mount = (state: DeskState) => {
    store = new Store(state);
    root = document.createElement("div");
    document.body.append(root);
    const ctx = {
      store,
      bridge: { brain: { use: vi.fn() } },
      runtime: runtimeOf(),
      keyOf,
      tr: (key: string, vars?: Record<string, unknown>) =>
        vars ? `${key} ${JSON.stringify(vars)}` : key,
    } as unknown as ShellCtx;
    dispose = mountRail(root, ctx);
  };
  const label = () => root.querySelector('[data-rail="desks"]')?.getAttribute("aria-label");

  afterEach(() => {
    dispose();
    root.remove();
  });

  it("counts none, not minus one, when no desk is known", () => {
    mount(emptyState("en"));
    expect(label()).toBe("desks · 0");
    store.set({ popover: "desks" });
    const pop = root.querySelector("[data-popover=desks]");
    expect(pop?.querySelector(".pop-title")?.textContent).toBe("desks · 0");
    // Nothing to bring here: the popover says so instead of offering a button that does nothing.
    expect(pop?.querySelector("[data-key=desks-bring]")).toBeNull();
    expect(pop?.querySelector(".pop-row")?.textContent).toBe("empty");
  });

  it("counts the desks other than this one", () => {
    mount(sampleState("en", 0));
    expect(label()).toBe("desks · 1");
    // A list that does not name this desk counts every desk in it.
    store.set({ desks: store.get().desks.filter((d) => !d.here) });
    expect(label()).toBe("desks · 1");
  });
});

describe("the Arrange button (ADR 0220)", () => {
  let root: HTMLDivElement;
  let store: Store;
  let dispose: () => void;
  const run = vi.fn(async () => undefined);

  const window_ = (id: string, more: Record<string, unknown> = {}) => ({
    id,
    plugin: "endue.shell",
    x: 0,
    y: 0,
    w: 400,
    h: 300,
    pinned: false,
    ...more,
  });
  const button = () => root.querySelector<HTMLButtonElement>('[data-rail="arrange"]');
  const actions = () => root.querySelector<HTMLElement>('[data-popover="arrange"]');
  const action = (key: string) =>
    actions()?.querySelector<HTMLButtonElement>(`[data-arrange="${key}"]`);
  const over = (el: Element | null) =>
    el?.dispatchEvent(new Event("pointerover", { bubbles: true }));
  const off = (el: Element | null) => el?.dispatchEvent(new Event("pointerleave"));

  beforeEach(() => {
    vi.useFakeTimers();
    run.mockClear();
    const state = sampleState("en", 0);
    store = new Store({
      ...state,
      wm: { ...state.wm, windows: { "1": [window_("notes")] } },
    } as DeskState);
    root = document.createElement("div");
    document.body.append(root);
    const ctx = {
      store,
      bridge: { brain: { use: vi.fn() } },
      runtime: runtimeOf(run),
      keyOf,
      tr: (key: string) => key,
    } as unknown as ShellCtx;
    dispose = mountRail(root, ctx);
  });

  afterEach(() => {
    dispose();
    root.remove();
    vi.useRealTimers();
  });

  it("is the rail's last button and shows its actions once the pointer is on it", () => {
    const all = [...root.querySelectorAll<HTMLElement>(".rail-button")].map((b) => b.dataset.rail);
    expect(all.at(-1)).toBe("arrange");
    expect(actions()).toBeNull();
    over(button());
    expect(store.get().popover).toBe("arrange");
    expect(
      [...(actions()?.querySelectorAll("[data-arrange]") ?? [])].map((b) => b.textContent),
    ).toEqual([
      "Tile windows⌥⌘G",
      "Cascade windows",
      "Spread windows out",
      "Restore previous layout",
    ]);
    expect(action("tile")?.getAttribute("aria-keyshortcuts")).toBe("Meta+Alt+G");
    expect(actions()?.querySelector("[role=separator]")?.nextElementSibling).toBe(
      action("restore"),
    );
  });

  it("puts them away once the pointer has left the button and the actions, not before", () => {
    over(button());
    off(root.querySelector(".rail"));
    vi.advanceTimersByTime(300);
    expect(actions()).not.toBeNull();
    // Onto the actions in time: they stay for as long as the pointer is on them.
    actions()?.parentElement?.dispatchEvent(new Event("pointerenter"));
    vi.advanceTimersByTime(2000);
    expect(actions()).not.toBeNull();
    actions()?.parentElement?.dispatchEvent(new Event("pointerleave"));
    vi.advanceTimersByTime(349);
    expect(actions()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(actions()).toBeNull();
    expect(store.get().popover).toBeNull();
  });

  it("keeps them open after a press, until the next press", () => {
    over(button());
    button()?.click();
    off(root.querySelector(".rail"));
    vi.advanceTimersByTime(2000);
    expect(actions()).not.toBeNull();
    button()?.click();
    expect(actions()).toBeNull();
    // With no pointer on it (the keyboard, a touch): a press opens them, and they stay.
    button()?.click();
    vi.advanceTimersByTime(2000);
    expect(actions()).not.toBeNull();
  });

  it("opens over no other popover of the rail", () => {
    store.set({ popover: "tasks" });
    over(button());
    expect(store.get().popover).toBe("tasks");
  });

  it("runs an action's command and closes; one that cannot run does nothing", () => {
    over(button());
    expect(action("restore")?.getAttribute("aria-disabled")).toBe("true");
    action("restore")?.click();
    expect(run).not.toHaveBeenCalled();
    expect(actions()).not.toBeNull();
    expect(action("tile")?.getAttribute("aria-disabled")).toBe("false");
    action("tile")?.click();
    expect(run).toHaveBeenCalledWith("desk.windows.tile");
    expect(actions()).toBeNull();
  });

  it("offers Restore once the window manager has an arrangement to put back", () => {
    over(button());
    store.set({ wm: { ...store.get().wm, restorable: true } });
    expect(action("restore")?.getAttribute("aria-disabled")).toBe("false");
    action("restore")?.click();
    expect(run).toHaveBeenCalledWith("desk.windows.restore-arrangement");
  });
});

describe("the rail's shape (#292)", () => {
  let root: HTMLDivElement;
  let store: Store;
  let dispose: () => void;

  beforeEach(() => {
    store = new Store(sampleState("en", 0));
    root = document.createElement("div");
    document.body.append(root);
    const ctx = {
      store,
      bridge: { brain: { use: vi.fn() } },
      runtime: runtimeOf(),
      keyOf,
      tr: (key: string) => key,
    } as unknown as ShellCtx;
    dispose = mountRail(root, ctx);
  });

  afterEach(() => {
    dispose();
    root.remove();
  });

  it("stands in three groups", () => {
    const parts = [...root.querySelectorAll<HTMLElement>(".rail > *")].map(
      (part) => part.dataset.rail ?? part.getAttribute("role"),
    );
    expect(parts).toEqual([
      "brain",
      "sees",
      "tasks",
      "separator",
      "desks",
      "vm",
      "listen",
      "separator",
      "arrange",
    ]);
    expect(root.querySelectorAll(".rail button[data-rail]")).toHaveLength(7);
    expect(root.querySelectorAll('.rail [role="separator"]')).toHaveLength(2);
  });

  it("the button whose state is on takes the fill", () => {
    const on = () =>
      [...root.querySelectorAll<HTMLElement>(".rail .is-on")].map((b) => b.dataset.rail);
    const listen = () => root.querySelector<HTMLElement>('[data-rail="listen"]');
    // The sample desk listens.
    expect(on()).toEqual(["listen"]);
    expect(listen()?.getAttribute("aria-pressed")).toBe("true");
    store.set({ listening: false });
    expect(on()).toEqual([]);
    expect(listen()?.getAttribute("aria-pressed")).toBe("false");
  });

  it("names a button in its tooltip on hover and on focus, not while its popover is open", () => {
    const tooltip = root.querySelector<HTMLElement>("#rail-tooltip");
    const sees = () => root.querySelector<HTMLElement>('[data-rail="sees"]');
    expect(tooltip?.getAttribute("role")).toBe("tooltip");
    expect(tooltip?.hidden).toBe(true);
    sees()?.dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(tooltip?.hidden).toBe(false);
    expect(tooltip?.textContent).toBe("sees · 3");
    expect(tooltip?.dataset.edge).toBe("right");
    // The label follows what the button says now.
    store.set({ sees: { ...store.get().sees, mail: true } });
    expect(tooltip?.textContent).toBe("sees · 4");
    sees()?.click();
    expect(tooltip?.hidden).toBe(true);
    sees()?.click();
    expect(tooltip?.hidden).toBe(false);
    root.querySelector(".rail")?.dispatchEvent(new Event("pointerleave"));
    expect(tooltip?.hidden).toBe(true);
    sees()?.dispatchEvent(new Event("focusin", { bubbles: true }));
    expect(tooltip?.hidden).toBe(false);
    sees()?.dispatchEvent(new Event("focusout", { bubbles: true }));
    expect(tooltip?.hidden).toBe(true);
    expect(root.querySelector(".rail [title]")).toBeNull();
  });
});
