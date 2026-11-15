// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserBridge } from "../bridge/browser";
import { browserCore } from "../bridge/core";
import { ManualClock } from "../clock";
import { testWindowManager } from "../wm/testing";
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

describe("a press on a window (#251)", () => {
  /** A desk with two windows, the second in use; `decides`: its host hears the presses itself. */
  async function two(decides: boolean) {
    const root = document.createElement("div");
    document.body.append(root);
    const clock = new ManualClock();
    const epoch = Date.parse("2026-11-15T09:00:00Z");
    const wm = testWindowManager();
    const desk = mountDesk({
      root,
      bridge: browserBridge({ now: () => clock.now(), epoch }),
      core: browserCore({ manifests: [] }).client,
      plugins: { url: (id, path) => `/plugins/${id}/${path}` },
      windowManager: decides ? { ...wm, decidesPress: true } : wm,
      clock,
      epoch,
      platform: "mac",
      lang: "en",
    });
    desks.push(desk);
    const [first] = await wm.edit([{ op: "new-window" }]);
    const [second] = await wm.edit([{ op: "new-window" }]);
    const section = root.querySelector<HTMLElement>(`.surface[data-surface="${first}"]`);
    if (!section) throw new Error("the first window is not laid out");
    const press = () => section.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    /** A button of its title bar takes the focus, as a press on it or a Tab to it gives it. */
    const focusTool = () => {
      const tool = section.querySelector<HTMLElement>(".surface-tools button");
      tool?.focus();
      tool?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    };
    const release = () => section.dispatchEvent(new Event("pointerup", { bubbles: true }));
    return { desk, first, second, press, focusTool, release, edit: vi.spyOn(wm, "edit") };
  }

  it("asks for the window where the page is the one that hears it", {
    timeout: 30_000,
  }, async () => {
    const d = await two(false);
    expect(d.desk.store.get().focused).toBe(d.second);
    d.press();
    await vi.waitFor(() => expect(d.desk.store.get().focused).toBe(d.first));
  });

  it("asks for nothing where the window manager hears the presses itself", {
    timeout: 30_000,
  }, async () => {
    const d = await two(true);
    // The press, and the focus it moves to the button pressed: the window manager decided both.
    d.press();
    d.focusTool();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(d.edit).not.toHaveBeenCalled();
    expect(d.desk.store.get().focused).toBe(d.second);
    // The button let go, a focus the keys move there asks for its window, as before.
    d.release();
    d.focusTool();
    await vi.waitFor(() => expect(d.desk.store.get().focused).toBe(d.first));
  });
});
