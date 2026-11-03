// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAY_TO_ERIS } from "../eris/look";
import { mountComposer } from "./Composer";
import type { ShellCtx } from "./context";
import { Store, sampleState } from "./state";

describe("the talk line", () => {
  let root: HTMLDivElement;
  let input: HTMLInputElement;
  let dispose: () => void;
  let store: Store;
  const brainSay = vi.fn();
  const notify = vi.fn();
  const erisSay = vi.fn();
  const commands = vi.fn(() => [] as { id: string; title: string; keywords: string[] }[]);

  beforeEach(() => {
    vi.clearAllMocks();
    brainSay.mockReset().mockResolvedValue({ text: "Hello" });
    commands.mockReset().mockReturnValue([]);
    store = new Store(sampleState("en", 0));
    root = document.createElement("div");
    root.className = "shell";
    document.body.append(root);
    const ctx = {
      store,
      runtime: { commands: { list: commands, has: () => false }, notify },
      bridge: { brain: { say: brainSay } },
      eris: {
        say: erisSay,
        setState: (state: Parameters<ShellCtx["eris"]["setState"]>[0]) =>
          store.set((s) => ({ eris: { ...s.eris, state } })),
      },
      ticker: { animate: () => Promise.resolve() },
      reduced: () => true,
      keyOf: () => undefined,
      tr: (key: string) => `${store.get().lang}:${key}`,
    } as unknown as ShellCtx;
    dispose = mountComposer(root, ctx);
    input = root.querySelector("input") as HTMLInputElement;
  });

  afterEach(() => {
    dispose();
    root.remove();
  });

  function type(text: string) {
    input.focus();
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function key(key: string, init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    input.dispatchEvent(event);
    return event;
  }

  for (const source of ["talk line", "describe handoff"] as const) {
    it(`returns to idle and shows one localized notice when the brain fails from the ${source}`, async () => {
      store.set({ lang: "ko" });
      brainSay.mockRejectedValueOnce(new Error("offline"));
      if (source === "talk line") {
        type("hello");
        key("Enter");
      } else {
        document.dispatchEvent(new CustomEvent(SAY_TO_ERIS, { detail: { text: "hello" } }));
      }
      expect(store.get().eris.state).toBe("thinking");
      await vi.waitFor(() => expect(store.get().eris.state).toBe("idle"));
      expect(brainSay).toHaveBeenCalledExactlyOnceWith("hello");
      expect(erisSay).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledOnce();
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringMatching(/^ko:/) }),
      );
    });
  }

  for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
    it(`does not send Enter during composition (${JSON.stringify(init)})`, () => {
      type("hello");
      const event = key("Enter", init);
      expect(event.defaultPrevented).toBe(false);
      expect(brainSay).not.toHaveBeenCalled();
      expect(input.value).toBe("hello");
    });

    it(`leaves arrows and Escape to the IME (${JSON.stringify(init)})`, () => {
      commands.mockReturnValue([{ id: "hello", title: "Hello", keywords: ["hello"] }]);
      type("hello");
      for (const name of ["ArrowDown", "ArrowUp", "Escape"]) {
        expect(key(name, init).defaultPrevented).toBe(false);
        expect(store.get().composer).toEqual({ open: true, text: "hello", selected: 0 });
        expect(input.value).toBe("hello");
      }
    });
  }

  it("sends the line on a plain Enter", () => {
    type("hello");
    expect(key("Enter").defaultPrevented).toBe(true);
    expect(brainSay).toHaveBeenCalledExactlyOnceWith("hello");
    expect(input.value).toBe("");
  });

  it("navigates options with arrows and closes with Escape outside composition", () => {
    commands.mockReturnValue([{ id: "hello", title: "Hello", keywords: ["hello"] }]);
    type("hello");
    expect(key("ArrowDown").defaultPrevented).toBe(true);
    expect(store.get().composer.selected).toBe(1);
    expect(key("ArrowUp").defaultPrevented).toBe(true);
    expect(store.get().composer.selected).toBe(0);
    expect(key("Escape").defaultPrevented).toBe(true);
    expect(store.get().composer.open).toBe(false);
    expect(input.value).toBe("");
  });
});
