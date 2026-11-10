// The page's one shell is the CEF shell (ADR 0143): its commands and events go over `__deskNative`,
// and a page without it (a plain browser, a test) is refused with a reason instead of hanging.
import { afterEach, describe, expect, it, vi } from "vitest";

const scope = globalThis as { __deskNative?: unknown };

/** host.ts as a page loads it, with `native` as the page's channel. */
async function load(native?: { send(text: string): void; onMessage?: (text: string) => void }) {
  vi.resetModules();
  if (native) scope.__deskNative = native;
  else delete scope.__deskNative;
  return import("./host");
}

afterEach(() => {
  delete scope.__deskNative;
});

describe("the page's shell", () => {
  it("calls the CEF shell's commands and hears its events over __deskNative", async () => {
    const sent: Array<{ id: number; cmd: string; args: unknown }> = [];
    const native: { send(text: string): void; onMessage?: (text: string) => void } = {
      send: (text) => void sent.push(JSON.parse(text)),
    };
    const host = await load(native);
    const ready = host.invoke<boolean>("desk_ready", { status: "desk ready" });
    expect(sent).toEqual([{ id: 1, cmd: "desk_ready", args: { status: "desk ready" } }]);
    native.onMessage?.(JSON.stringify({ id: 1, ok: true }));
    await expect(ready).resolves.toBe(true);

    const heard: unknown[] = [];
    const off = await host.listen("desk://open-files", ({ payload }) => heard.push(payload));
    native.onMessage?.(JSON.stringify({ event: "desk://open-files", payload: 1 }));
    off();
    native.onMessage?.(JSON.stringify({ event: "desk://open-files", payload: 2 }));
    expect(heard).toEqual([1]);
    expect(host.adapter().name).toBe("cef");
  });

  it("refuses every command without the shell, naming why, and sends no event", async () => {
    const host = await load();
    await expect(host.invoke("desk_ready")).rejects.toThrow(`desk_ready: ${host.NO_SHELL}`);
    const off = await host.listen("bridge://event", () => {
      throw new Error("no event without a shell");
    });
    expect(() => off()).not.toThrow();
    const call = host.adapter().call({ id: 1, method: "perm.query", params: {} } as never);
    await expect(call).rejects.toThrow(host.NO_SHELL);
  });
});
