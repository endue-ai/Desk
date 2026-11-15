// @vitest-environment jsdom
// The agent bar unfolds (issue 294, design 291): once the pointer has rested on it, or from the
// unfold control with the keyboard; it folds once neither the pointer nor the focus is in it, and
// a pin, which is the store's and so the session's, keeps it. The waits run on the injected clock.
// jsdom lays nothing out: these prove the DOM, the store and the clock; the paint is the e2e's.
import { afterEach, describe, expect, it } from "vitest";
import { agentId, sampleDirectory } from "../bridge/directory";
import { localAgentsStub } from "../bridge/local-agents";
import { ManualClock } from "../clock";
import { testWindowManager } from "../wm/testing";
import { takeDesk } from "../wm/view";
import { FOLD_MS, UNFOLD_MS } from "./bar-unfold";
import type { ShellCtx } from "./context";
import { t } from "./copy";
import { mountSideBar } from "./SideBar";
import { type DeskState, emptyState, Store } from "./state";
import { Ticker } from "./ticker";

const NOW = Date.parse("2026-11-05T09:01:05Z");

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const off of cleanups.splice(0)) off();
  document.body.replaceChildren();
});

/** The bar over the sample directory's Home space and the two agent programs, on a manual clock. */
async function setup(seed: Partial<DeskState> = {}) {
  const directory = sampleDirectory(NOW);
  const local = localAgentsStub({ epoch: 0, stepMs: 0 });
  const store = new Store({
    ...emptyState("en"),
    localAgents: await local.list(),
    spaces: directory.spaces,
    spaceId: "sp_home",
    agents: directory.agents.map((a) => a.agent),
    spaceAgents: [agentId(1), agentId(2), agentId(3)],
    agentId: agentId(1),
    tasks: directory.tasks,
    directory: "ready",
    ...seed,
  });
  const wm = testWindowManager();
  wm.connect((published) => takeDesk(store, published));
  const clock = new ManualClock();
  const ticker = new Ticker(clock);
  const root = document.createElement("div");
  document.body.append(root);
  const ctx = {
    store,
    wm,
    bridge: { localAgents: local },
    runtime: {
      shortcuts: { focused: null },
      focusSurface: () => undefined,
      followSurface: () => undefined,
    },
    ticker,
    tr: (key: Parameters<typeof t>[1], vars?: Record<string, string | number>) =>
      t("en", key, vars),
    wall: () => NOW + clock.now(),
  } as unknown as ShellCtx;
  cleanups.push(mountSideBar(root, ctx), () => ticker.dispose());
  const bar = root.querySelector<HTMLElement>(".sidebar");
  if (!bar) throw new Error("no agent bar");
  const one = (selector: string) => {
    const el = bar.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`no ${selector}`);
    return el;
  };
  return {
    store,
    clock,
    bar,
    one,
    unfolded: () => bar.classList.contains("is-unfolded"),
    control: () => one('[data-key="agents-unfold"]'),
    pin: () => one('[data-key="agents-pin"]'),
    enter: () => bar.dispatchEvent(new Event("pointerenter")),
    leave: () => bar.dispatchEvent(new Event("pointerleave")),
    /** Rest the pointer on the bar until it unfolds. */
    rest: () => {
      bar.dispatchEvent(new Event("pointerenter"));
      clock.advance(UNFOLD_MS);
    },
  };
}

describe("the agent bar unfolds (issue 294)", () => {
  it("unfolds once the pointer has rested on it for UNFOLD_MS, and not before", async () => {
    const { clock, enter, unfolded } = await setup();
    expect(unfolded()).toBe(false);
    enter();
    clock.advance(UNFOLD_MS - 1);
    expect(unfolded()).toBe(false);
    clock.advance(1);
    expect(unfolded()).toBe(true);
  });

  it("a pointer that leaves before then unfolds nothing", async () => {
    const { clock, enter, leave, unfolded } = await setup();
    enter();
    clock.advance(UNFOLD_MS - 1);
    leave();
    clock.advance(UNFOLD_MS);
    expect(unfolded()).toBe(false);
    // The rest starts over with the pointer's next visit.
    enter();
    clock.advance(UNFOLD_MS - 1);
    expect(unfolded()).toBe(false);
    clock.advance(1);
    expect(unfolded()).toBe(true);
  });

  it("folds FOLD_MS after the pointer has left, and stays while the pointer or the focus is in it", async () => {
    const { clock, rest, enter, leave, one, unfolded } = await setup();
    rest();
    clock.advance(FOLD_MS * 2);
    expect(unfolded()).toBe(true);
    leave();
    clock.advance(FOLD_MS - 1);
    expect(unfolded()).toBe(true);
    // Back before it folds: the wait is over.
    enter();
    clock.advance(FOLD_MS);
    expect(unfolded()).toBe(true);
    leave();
    clock.advance(FOLD_MS - 1);
    expect(unfolded()).toBe(true);
    clock.advance(1);
    expect(unfolded()).toBe(false);

    // With the focus on a row it stays, the pointer gone; it folds once the focus has left too.
    rest();
    one(`[data-agent="${agentId(2)}"]`).focus();
    leave();
    clock.advance(FOLD_MS * 2);
    expect(unfolded()).toBe(true);
    (document.activeElement as HTMLElement).blur();
    clock.advance(FOLD_MS - 1);
    expect(unfolded()).toBe(true);
    clock.advance(1);
    expect(unfolded()).toBe(false);
  });

  it("the unfold control, the bar's first, unfolds and folds from the keyboard", async () => {
    const { clock, bar, control, unfolded } = await setup();
    expect(bar.querySelector("button")).toBe(control());
    expect(control().getAttribute("aria-label")).toBe("Show names");
    expect(control().getAttribute("aria-expanded")).toBe("false");
    expect(control().hasAttribute("title")).toBe(false);

    control().focus();
    control().click();
    // At once, with no clock; the focus stays on the control through the bar's redraw.
    expect(unfolded()).toBe(true);
    expect(document.activeElement).toBe(control());
    expect(bar.querySelector("button")).toBe(control());
    expect(control().getAttribute("aria-expanded")).toBe("true");
    expect(control().getAttribute("aria-label")).toBe("Hide names");
    clock.advance(FOLD_MS * 2);
    expect(unfolded()).toBe(true);

    control().click();
    expect(unfolded()).toBe(false);
    expect(document.activeElement).toBe(control());
    expect(control().getAttribute("aria-expanded")).toBe("false");
    expect(control().getAttribute("aria-label")).toBe("Show names");

    // Unfolded from it, the bar folds FOLD_MS after the focus has left the bar.
    control().click();
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    clock.advance(FOLD_MS - 1);
    expect(unfolded()).toBe(true);
    clock.advance(1);
    expect(unfolded()).toBe(false);
  });

  it("the pin keeps it unfolded and is the store's", async () => {
    const { store, clock, bar, rest, enter, leave, pin, unfolded } = await setup();
    // Folded and not pinned, the bar holds no pin.
    expect(bar.querySelector('[data-key="agents-pin"]')).toBeNull();
    rest();
    expect(pin().getAttribute("aria-label")).toBe("Keep open");
    expect(pin().getAttribute("aria-pressed")).toBe("false");
    expect(pin().hasAttribute("title")).toBe(false);
    expect(store.get().agentsPinned).toBe(false);

    pin().click();
    expect(store.get().agentsPinned).toBe(true);
    expect(pin().getAttribute("aria-pressed")).toBe("true");
    leave();
    clock.advance(FOLD_MS * 3);
    expect(unfolded()).toBe(true);

    // Let go, it stays for as long as the pointer does, and folds once that has left.
    enter();
    pin().click();
    expect(store.get().agentsPinned).toBe(false);
    expect(pin().getAttribute("aria-pressed")).toBe("false");
    clock.advance(FOLD_MS * 2);
    expect(unfolded()).toBe(true);
    leave();
    clock.advance(FOLD_MS - 1);
    expect(unfolded()).toBe(true);
    clock.advance(1);
    expect(unfolded()).toBe(false);
    expect(bar.querySelector('[data-key="agents-pin"]')).toBeNull();
  });

  it("a desk whose store says pinned starts unfolded", async () => {
    const { store, clock, pin, unfolded, control } = await setup({ agentsPinned: true });
    expect(unfolded()).toBe(true);
    expect(pin().getAttribute("aria-pressed")).toBe("true");
    expect(control().getAttribute("aria-expanded")).toBe("true");
    // A session that comes back without the pin (link.ts) lets it fold; one with it unfolds it.
    store.set({ agentsPinned: false });
    clock.advance(FOLD_MS - 1);
    expect(unfolded()).toBe(true);
    clock.advance(1);
    expect(unfolded()).toBe(false);
    store.set({ agentsPinned: true });
    expect(unfolded()).toBe(true);
  });

  it("unfolding and pinning ask the window manager for nothing", async () => {
    const { store, clock, rest, leave, pin, control, unfolded } = await setup();
    const before = { rev: store.get().rev, wm: store.get().wm };
    rest();
    pin().click();
    leave();
    clock.advance(FOLD_MS);
    pin().click();
    control().click();
    expect(unfolded()).toBe(false);
    control().click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(unfolded()).toBe(true);
    expect(store.get().rev).toBe(before.rev);
    expect(store.get().wm).toBe(before.wm);
  });
});
