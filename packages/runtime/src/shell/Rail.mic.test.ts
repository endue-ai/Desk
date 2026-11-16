// @vitest-environment jsdom
// The microphone indicator (#311): while anything captures, the rail's Listen button is on with a
// dot and says who listens; pressing it stops every capture. With nothing capturing it is Hey Eris.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureInForce } from "../bridge/types";
import type { ShellCtx } from "./context";
import { mountRail } from "./Rail";
import { sampleState, Store } from "./state";

const runtime = {
  keymap: { onChange: () => () => {}, bindings: () => [] },
  commands: { run: vi.fn(async () => undefined) },
};

describe("the microphone on the rail", () => {
  let root: HTMLDivElement;
  let store: Store;
  let dispose: () => void;
  let tell: ((captures: readonly CaptureInForce[]) => void) | undefined;
  const stopCapture = vi.fn(async (_id: string) => {});
  const request = vi.fn(async () => true);

  beforeEach(() => {
    stopCapture.mockClear();
    request.mockClear();
    store = new Store(sampleState("en", 0));
    store.set({ listening: false, popover: null });
    root = document.createElement("div");
    document.body.append(root);
    const ctx = {
      store,
      bridge: {
        perm: { request },
        audio: {
          levels: () => ({ user: [], eris: [] }),
          captures: (listener: (captures: readonly CaptureInForce[]) => void) => {
            tell = listener;
            return () => {
              tell = undefined;
            };
          },
          stopCapture,
        },
      },
      runtime,
      keyOf: () => "",
      tr: (key: string) => key,
    } as unknown as ShellCtx;
    dispose = mountRail(root, ctx);
  });

  afterEach(() => {
    dispose();
    root.remove();
  });

  const listen = () => root.querySelector<HTMLButtonElement>('[data-rail="listen"]');
  const settle = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it("while anything captures the Listen button shows the microphone is on", () => {
    expect(listen()?.classList.contains("is-on")).toBe(false);
    tell?.([{ captureId: "c1", caller: "example.notes" }]);
    const button = listen();
    expect(button?.classList.contains("is-on")).toBe(true);
    expect(button?.querySelector(".rail-dot")).not.toBeNull();
    expect(button?.getAttribute("aria-pressed")).toBe("true");
    const label = button?.getAttribute("aria-label") ?? "";
    expect(label).toContain("mic");
    expect(label).toContain("example.notes");
  });

  it("pressing it stops every capture", async () => {
    tell?.([
      { captureId: "c1", caller: "example.notes" },
      { captureId: "c2", caller: "example.other" },
    ]);
    listen()?.click();
    await settle();
    expect(stopCapture.mock.calls.map(([id]) => id)).toEqual(["c1", "c2"]);
    expect(request).not.toHaveBeenCalled();
    tell?.([]);
    expect(listen()?.classList.contains("is-on")).toBe(false);
    expect(listen()?.getAttribute("aria-label")).toBe("listenOff");
  });

  it("with nothing capturing it toggles Hey Eris as before", async () => {
    listen()?.click();
    await settle();
    expect(request).toHaveBeenCalledWith("mic");
    expect(stopCapture).not.toHaveBeenCalled();
    expect(store.get().listening).toBe(true);
  });
});
