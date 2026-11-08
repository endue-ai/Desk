// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserBridge } from "../bridge/browser";
import { browserCore } from "../bridge/core";
import { ManualClock } from "../clock";
import { type Desk, mountDesk } from "./Desk";

const desks: Desk[] = [];
afterEach(() => {
  for (const desk of desks.splice(0)) desk.dispose();
  document.body.replaceChildren();
});

describe("the desk's start", () => {
  // The whole desk mounts here, which takes a while on a busy machine.
  it("lists the local agents while the desk's start still waits", { timeout: 30_000 }, async () => {
    // A start that never finishes, as when the saved session reopens a file whose plugin waits on
    // a permission prompt nobody answers: the runtime's first call is never answered.
    const core = browserCore({
      manifests: [],
      handlers: { "perm.query": () => new Promise<never>(() => undefined) },
    });
    const root = document.createElement("div");
    document.body.append(root);
    const epoch = Date.parse("2026-11-07T09:00:00Z");
    const clock = new ManualClock();
    const desk = mountDesk({
      root,
      bridge: browserBridge({ now: () => clock.now(), epoch, localAgents: { stepMs: 0 } }),
      core: core.client,
      plugins: { url: (id, path) => `/plugins/${id}/${path}` },
      clock,
      epoch,
      platform: "mac",
      lang: "en",
    });
    desks.push(desk);
    let ready = false;
    void desk.ready.then(() => {
      ready = true;
    });

    await vi.waitFor(
      () => expect(desk.store.get().localAgents.map((a) => a.id)).toEqual(["claude", "codex"]),
      { timeout: 20_000, interval: 10 },
    );
    expect(ready).toBe(false);
    expect(root.querySelectorAll("[data-local-agent]")).toHaveLength(2);
  });
});
