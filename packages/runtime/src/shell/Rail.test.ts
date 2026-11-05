// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrainStatus } from "../bridge/types";
import type { ShellCtx } from "./context";
import { mountRail } from "./Rail";
import { Store, sampleState } from "./state";

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

  it("offers endue AI, local and echo and marks the brain the desk chose", () => {
    expect(segments()).toEqual([
      ["brain-endue", "true"],
      ["brain-local", "false"],
      ["brain-echo", "false"],
    ]);
  });

  it("switches through bridge.brain.use and shows what the desk answers", async () => {
    const local: BrainStatus = { mode: "local", model: "llama3.2", brain: "local" };
    use.mockResolvedValue(local);
    root.querySelector<HTMLButtonElement>("[data-key=brain-local]")?.click();
    await vi.waitFor(() => expect(store.get().brain).toEqual(local));
    expect(use).toHaveBeenCalledWith("local");
    expect(segments()[1]).toEqual(["brain-local", "true"]);
  });

  it("keeps the chosen brain marked while the local brain stands in for it", () => {
    store.set({ brain: { mode: "local", model: "llama3.2", brain: "echo", fallback: true } });
    expect(segments()[2]).toEqual(["brain-echo", "true"]);
    const note = root.querySelector("[data-popover=brain] .brain-fallback");
    expect(note?.textContent).toBe("brainFallback");
  });
});
