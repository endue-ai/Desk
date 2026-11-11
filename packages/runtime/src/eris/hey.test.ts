// The rail's Listening button (Hey Eris) says it listens only once the person allows the microphone
// (#161, finding 11): while the question is open and after a no it stays off.
import { describe, expect, it } from "vitest";
import type { ShellCtx } from "../shell/context";
import { emptyState, Store } from "../shell/state";
import { toggleListening } from "./hey";

function desk() {
  const answers: Array<(granted: boolean) => void> = [];
  const ctx = {
    store: new Store(emptyState("en")),
    bridge: {
      perm: {
        request: (scope: string) =>
          new Promise<boolean>((resolve) => {
            expect(scope).toBe("mic");
            answers.push(resolve);
          }),
      },
    },
  } as unknown as ShellCtx;
  const settle = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return { ctx, answers, settle, listening: () => ctx.store.get().listening };
}

describe("the rail's Listening button", () => {
  it("stays off while the microphone question is open, and turns on once it is allowed", async () => {
    const d = desk();
    void toggleListening(d.ctx);
    await d.settle();
    expect(d.listening()).toBe(false);
    // A second press while the question is up asks nothing more.
    void toggleListening(d.ctx);
    expect(d.answers).toHaveLength(1);
    d.answers[0]?.(true);
    await d.settle();
    expect(d.listening()).toBe(true);
  });

  it("stays off after a no, and turns off at once without asking", async () => {
    const d = desk();
    void toggleListening(d.ctx);
    d.answers[0]?.(false);
    await d.settle();
    expect(d.listening()).toBe(false);
    d.ctx.store.set({ listening: true });
    await toggleListening(d.ctx);
    expect(d.listening()).toBe(false);
    expect(d.answers).toHaveLength(1);
  });
});
