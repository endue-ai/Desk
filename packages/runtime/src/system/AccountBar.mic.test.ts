// @vitest-environment jsdom
// The microphone in the account bar (#311, ADR 0245): the bar stays when the rail is hidden or
// another plugin holds role:rail, so while anything captures the avatar says so and its menu's
// first row stops every capture.
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserBridge } from "../bridge/browser";
import type { CaptureInForce } from "../bridge/types";
import type { ShellCtx } from "../shell/context";
import { Store, sampleState } from "../shell/state";
import { mountAccountBar } from "./AccountBar";

function setup(inForce: readonly CaptureInForce[]) {
  const bridge = browserBridge({ now: () => 0 });
  bridge.user = { info: async () => ({ name: "Mira" }) };
  let tell: ((captures: readonly CaptureInForce[]) => void) | undefined;
  const stopCapture = vi.fn(async (_id: string) => {});
  bridge.audio = {
    ...bridge.audio,
    captures: (listener) => {
      tell = listener;
      listener(inForce);
      return () => {
        tell = undefined;
      };
    },
    stopCapture,
  };
  const commands = new Map<string, (args?: unknown) => unknown>();
  const store = new Store(sampleState("en", 0));
  store.set({ attention: [], popover: null });
  const ctx = {
    store,
    bridge,
    tr: (key: string) => key,
    keyOf: () => undefined,
    eris: { say: vi.fn(), setState: vi.fn() },
    runtime: {
      commands: {
        define: (id: string, spec: { run: (args?: unknown) => unknown }) => {
          commands.set(id, spec.run);
          return () => commands.delete(id);
        },
        run: async (id: string, args?: unknown) => commands.get(id)?.(args),
      },
    },
  } as unknown as ShellCtx;
  const root = document.createElement("div");
  document.body.append(root);
  const unmount = mountAccountBar(root, ctx);
  const profile = () => root.querySelector<HTMLElement>(".account-profile");
  const row = () => root.querySelector<HTMLElement>('.account-popover [data-key="account-mic"]');
  return {
    commands,
    profile,
    row,
    stopCapture,
    tell: (c: readonly CaptureInForce[]) => tell?.(c),
    unmount,
  };
}

afterEach(() => document.body.replaceChildren());

describe("the microphone in the account bar", () => {
  it("the avatar says the microphone is on and who listens", () => {
    const bar = setup([{ captureId: "c1", caller: "example.notes" }]);
    expect(bar.profile()?.dataset.mic).toBe("on");
    expect(bar.profile()?.hasAttribute("data-attention")).toBe(true);
    expect(bar.profile()?.getAttribute("aria-label")).toContain("example.notes");
    bar.tell([]);
    expect(bar.profile()?.dataset.mic).toBeUndefined();
    expect(bar.profile()?.hasAttribute("data-attention")).toBe(false);
    bar.unmount();
  });

  it("the menu's first row stops every capture", async () => {
    const bar = setup([
      { captureId: "c1", caller: "example.notes" },
      { captureId: "c2", caller: "desk" },
    ]);
    await bar.commands.get("desk.account.open")?.();
    const row = bar.row();
    expect(row?.getAttribute("aria-label")).toContain("Eris");
    const first = row?.parentElement?.querySelector('[role="menuitem"]');
    expect(first).toBe(row);
    row?.click();
    await vi.waitFor(() => expect(bar.stopCapture).toHaveBeenCalledTimes(2));
    expect(bar.stopCapture.mock.calls.map(([id]) => id)).toEqual(["c1", "c2"]);
    bar.unmount();
  });

  it("with nothing capturing the menu has no microphone row", async () => {
    const bar = setup([]);
    await bar.commands.get("desk.account.open")?.();
    expect(bar.row()).toBeNull();
    expect(bar.profile()?.dataset.mic).toBeUndefined();
    bar.unmount();
  });
});
