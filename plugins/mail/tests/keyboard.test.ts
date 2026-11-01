import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "../../../packages/bridge/src/stub-query";
import { ACCOUNT, type Handlers, mount, sample } from "./harness";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("mail fixture startup", () => {
  it.each(["init", "mailbox", "unread", "subscription"] as const)(
    "waits for a delayed %s response before returning a ready app",
    async (blocked) => {
      const entered = deferred();
      const release = deferred();
      const wait = async () => {
        entered.resolve();
        await release.promise;
      };
      const handlers: Handlers = {
        "init.get": async () => {
          if (blocked === "init") await wait();
          return { profile: "default", settings: {} };
        },
        "data.query": async ({ query }) => {
          const unread = query.where?.some((part) => part.field === "unread") ?? false;
          if ((blocked === "unread" && unread) || (blocked === "mailbox" && !unread)) await wait();
          return page(sample(), query);
        },
        "data.subscribe": async () => {
          if (blocked === "subscription") await wait();
          return { subscriptionId: "startup" };
        },
      };
      let ready = false;
      const pending = mount({ handlers }).then((mounted) => {
        ready = true;
        return mounted;
      });
      await entered.promise;
      expect(ready).toBe(false);
      release.resolve();
      const { app, host, view } = await pending;
      expect(view.shown()).toHaveLength(3);
      expect(view.navs.at(-1)?.mailboxes.find((box) => box.id === "inbox")?.count).toBe("2");
      expect(await host.command("endue.mail.open")).toBe("inbox");
      await app.key("ArrowDown");
      expect(view.selected()).toBe(`${ACCOUNT}#t-lunch`);
    },
  );

  it("returns after startup without waiting for timers or scheduling a recount or autosave", async () => {
    vi.useFakeTimers();
    const timer = vi.spyOn(globalThis, "setTimeout");
    const { params, view } = await mount();
    expect(view.shown()).toHaveLength(3);
    expect(params("data.query")).toHaveLength(2);
    expect(timer.mock.calls.some(([, delay]) => delay === 300)).toBe(false);
    await vi.runAllTimersAsync();
    expect(params("data.query")).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
