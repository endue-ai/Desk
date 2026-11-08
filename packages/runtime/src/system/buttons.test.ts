// @vitest-environment jsdom
// A shell button whose command fails says why (#582): one error notice naming the command and the
// reason; `cancelled` says nothing. The account bar and the safe-mode badge, over a real registry.
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserBridge } from "../bridge/browser";
import { browserCore } from "../bridge/core";
import { CommandError, Commands } from "../commands";
import type { NoticeInput } from "../notify";
import type { ShellCtx } from "../shell/context";
import { Store, sampleState } from "../shell/state";
import { mountAccountBar } from "./AccountBar";
import { mountSafeBadge } from "./safe-mode";

async function shell(id: string, title: string, run: () => unknown) {
  const core = browserCore({ manifests: [] });
  const commands = new Commands(core.client);
  const notices: NoticeInput[] = [];
  let ran = 0;
  commands.define(id, {
    title,
    owner: "desk",
    run: () => {
      ran++;
      return run();
    },
  });
  await commands.settled();
  const bridge = browserBridge({ now: () => 0 });
  bridge.user = { info: async () => ({ name: "Mira" }) };
  const ctx = {
    store: new Store(sampleState("en", 0)),
    bridge,
    tr: (key: string) => key,
    eris: { say: vi.fn(), setState: vi.fn() },
    runtime: { commands, notify: (input: NoticeInput) => void notices.push(input) },
  } as unknown as ShellCtx;
  const root = document.createElement("div");
  document.body.replaceChildren(root);
  // A second desk in one test spies on the same console.error: count from here.
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  log.mockClear();
  const click = (key: string) =>
    root.querySelector<HTMLButtonElement>(`[data-key=${key}]`)?.click();
  return { ctx, root, notices, log, click, ran: () => ran };
}

const fails = (why: string) => () => {
  throw new Error(why);
};
const cancels = () => {
  throw new CommandError("cancelled", "the person closed the pick");
};

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("a shell button whose command fails", () => {
  it("the account bar's Settings button that fails shows one error notice; a cancelled one shows none", async () => {
    const failing = await shell("desk.settings.open", "Open settings", fails("no settings window"));
    const unmount = mountAccountBar(failing.root, failing.ctx);
    failing.click("account-settings");
    await vi.waitFor(() => expect(failing.notices).toHaveLength(1));
    expect(failing.notices[0]).toEqual({
      caller: "desk",
      title: "Open settings failed",
      body: "no settings window",
      level: "error",
    });
    expect(failing.log).toHaveBeenCalledOnce();
    unmount();

    const cancelled = await shell("desk.settings.open", "Open settings", cancels);
    const off = mountAccountBar(cancelled.root, cancelled.ctx);
    cancelled.click("account-settings");
    await vi.waitFor(() => expect(cancelled.ran()).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(cancelled.notices).toEqual([]);
    expect(cancelled.log).not.toHaveBeenCalled();
    off();
  });

  it("Start normally on a desk that cannot start itself again says why", async () => {
    const d = await shell(
      "desk.start.normally",
      "Start normally, without safe mode",
      fails("This desk cannot start itself again"),
    );
    const off = mountSafeBadge(d.root, d.ctx, { reason: "asked", heldOff: [] });
    d.click("start-normally");
    await vi.waitFor(() => expect(d.notices).toHaveLength(1));
    expect(d.notices[0]).toMatchObject({
      title: "Start normally, without safe mode failed",
      body: "This desk cannot start itself again",
      level: "error",
    });
    off();
  });
});
