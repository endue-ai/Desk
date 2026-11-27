// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import type { ShellCtx } from "../shell/context";
import { Store, sampleState } from "../shell/state";
import { mountErrands } from "./errand";

it("shows one dotted signal through a cloud turn, including failure; a local turn is quiet", async () => {
  vi.useFakeTimers();
  let fail!: (error: Error) => void;
  const pendingReply = new Promise<{ text: string }>((_, reject) => {
    fail = reject;
  });
  const say = vi.fn(() => pendingReply);
  const store = new Store(sampleState("en", 0));
  const shell = document.createElement("div");
  const body = document.createElement("div");
  body.className = "eris-body";
  shell.append(body);
  const ctx = { store, bridge: { brain: { say } } } as unknown as ShellCtx;
  const errands = mountErrands(() => shell, ctx);
  try {
    store.set({ brain: { mode: "cloud", credits: 1 } });
    const pending = errands.say("hello");
    const signal = shell.querySelector<HTMLElement>(".eris-signal");
    expect(signal?.dataset.leg).toBe("out");
    expect(signal?.textContent).toBe("");
    await vi.advanceTimersByTimeAsync(350);
    expect(signal?.dataset.leg).toBe("there");
    fail(new Error("offline"));
    await expect(pending).rejects.toThrow("offline");
    expect(signal?.dataset.leg).toBe("back");
    await vi.advanceTimersByTimeAsync(350);
    expect(shell.contains(signal)).toBe(false);
    store.set({ brain: { mode: "local", model: "local" } });
    say.mockResolvedValueOnce({ text: "hello" });
    await errands.say("hello");
    expect(shell.querySelector(".eris-signal")).toBeNull();
  } finally {
    errands.dispose();
    vi.useRealTimers();
  }
});
