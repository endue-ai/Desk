// @vitest-environment jsdom
// A notice's action button whose command fails says why (#582): one error notice naming the
// command and the reason, where the acted-on notice was; `cancelled` says nothing.
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserCore } from "../bridge/core";
import { ManualClock } from "../clock";
import { CommandError } from "../commands";
import { PolicyHub } from "../hub";
import type { DeskContext } from "./context";
import { installNotify } from "./notify";

async function desk(run: () => unknown) {
  const core = browserCore({ manifests: [] });
  const hub = new PolicyHub(core.client);
  const ctx = {
    hub,
    bridge: core.client,
    clock: new ManualClock(),
    mounted: () => false,
  } as unknown as DeskContext;
  const line = document.createElement("footer");
  document.body.replaceChildren(line);
  const policy = installNotify(ctx, line);
  let ran = 0;
  hub.commands.define("example.retry", {
    title: "Retry the upload",
    owner: "desk",
    run: () => {
      ran++;
      return run();
    },
  });
  await hub.commands.settled();
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  policy.notify({
    caller: "desk",
    title: "The upload stopped",
    level: "warning",
    actions: [{ label: "Retry", command: "example.retry" }],
  });
  const click = () => line.querySelector<HTMLButtonElement>(".desk-status-action")?.click();
  const errors = () => policy.notifications.history().filter((n) => n.level === "error");
  return { policy, line, click, errors, log, ran: () => ran };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("a notice's action", () => {
  it("a notice's action that fails shows one error notice naming it", async () => {
    const d = await desk(() => {
      throw new Error("the server is away");
    });
    d.click();
    await vi.waitFor(() => expect(d.errors()).toHaveLength(1));
    expect(d.errors()[0]).toMatchObject({
      caller: "desk",
      title: "Retry the upload failed",
      body: "the server is away",
      level: "error",
    });
    expect(d.policy.notifications.current()?.level).toBe("error");
    expect(d.line.textContent).toBe("Retry the upload failed — the server is away");
    expect(d.log).toHaveBeenCalledOnce();
  });

  it("a cancelled action shows none", async () => {
    const d = await desk(() => {
      throw new CommandError("cancelled", "the person closed the pick");
    });
    d.click();
    await vi.waitFor(() => expect(d.ran()).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(d.errors()).toEqual([]);
    expect(d.policy.notifications.current()).toBeNull();
    expect(d.log).not.toHaveBeenCalled();
  });
});
