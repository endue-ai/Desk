// @vitest-environment jsdom
// The talk line's line on its way into Eris (ADR 0275): her errands for it wait until it is in her
// and read, her ring says what she is at, a line that runs nothing lights nothing, and the talk line
// hands her the line's flight. The errands themselves: errand.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrainStep } from "../bridge/types";
import { mountComposer } from "../shell/Composer";
import type { ShellCtx } from "../shell/context";
import { Store, sampleState } from "../shell/state";
import { testWindowManager } from "../wm/testing";
import { takeDesk } from "../wm/view";
import { mountErrands, READ_MS } from "./errand";
import { USE } from "./visiting";

const TOOL: BrainStep = {
  kind: "tool",
  callId: "c1",
  command: "endue.mail.latest",
  provider: "endue.mail",
  title: "Latest mail",
};
const BACK: BrainStep = { ...TOOL, kind: "tool-result", ok: true };

/** An element laid out at `rect` in jsdom, which lays nothing out by itself. */
function at(el: HTMLElement, rect: { left: number; top: number; width: number; height: number }) {
  const box = { ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height };
  el.getBoundingClientRect = () => ({ ...box, x: box.left, y: box.top, toJSON: () => box });
  el.getClientRects = () => [box] as unknown as DOMRectList;
  return el;
}

describe("a line on its way into Eris, and what she does with it", () => {
  let shell: HTMLDivElement;
  let store: Store;
  let ctx: ShellCtx;
  /** Each animation's last frame, after its update saw every t it would. */
  const frames: number[] = [];

  beforeEach(() => {
    frames.length = 0;
    store = new Store(sampleState("en", 0));
    shell = document.createElement("div");
    shell.className = "shell";
    const eris = document.createElement("div");
    eris.className = "eris";
    eris.append(at(document.createElement("div"), { left: 600, top: 40, width: 128, height: 138 }));
    eris.firstElementChild?.classList.add("eris-body");
    shell.append(eris);
    document.body.append(shell);
    ctx = {
      store,
      eris: {
        say: vi.fn(),
        setState: (state: Parameters<ShellCtx["eris"]["setState"]>[0]) =>
          store.set((s) => ({ eris: { ...s.eris, state } })),
      },
      ticker: {
        animate: (ms: number, _ease: unknown, update: (t: number) => void) => {
          update(0.5);
          update(1);
          frames.push(ms);
          return Promise.resolve();
        },
      },
      reduced: () => false,
    } as unknown as ShellCtx;
  });

  afterEach(() => shell.remove());

  /** A window's section in the desk's page at `rect`, showing `surface` (a plugin's) all over it. */
  function windowAt(id: string, surface: string, rect: Parameters<typeof at>[1]) {
    const section = at(document.createElement("section"), rect);
    section.className = "surface";
    section.dataset.surface = id;
    const plugin = at(document.createElement("section"), rect);
    plugin.dataset.surface = surface;
    section.append(plugin);
    shell.append(section);
    return section;
  }

  it("her errands for a line wait until it is in her and read, and her ring says what she is at", async () => {
    windowAt("w1", "endue.mail", { left: 100, top: 300, width: 400, height: 300 });
    const eris = shell.querySelector<HTMLElement>(".eris") as HTMLElement;
    // Her reading of the line, the first wait of its length, takes as long as the test says.
    const animate = ctx.ticker.animate.bind(ctx.ticker);
    let read: (() => void) | undefined;
    ctx.ticker.animate = (ms, ease, update) => {
      if (ms !== READ_MS || read) return animate(ms, ease, update);
      return new Promise<void>((resolve) => {
        read = resolve;
      });
    };
    let arrive = () => {};
    const errands = mountErrands(() => shell, ctx);
    errands.ask(
      new Promise<void>((resolve) => {
        arrive = resolve;
      }),
    );
    errands.step(TOOL);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(eris.dataset.mind, "the line is on its way").toBeUndefined();
    expect(shell.querySelector(".errand"), "nothing leaves before the line is in her").toBeNull();

    arrive();
    await vi.waitFor(() => expect(eris.dataset.mind).toBe("reading"));
    expect(shell.querySelector(".errand"), "she reads it first").toBeNull();
    expect(store.get().erisWindows).toEqual([]);

    read?.();
    await vi.waitFor(() => expect(store.get().erisWindows).toEqual([{ id: "w1", glow: USE }]));
    expect(eris.dataset.mind, "her spark is out with the plugin").toBe("waiting");

    errands.step(BACK);
    await vi.waitFor(() => expect(shell.querySelector(".errand")).toBeNull());
    expect(eris.dataset.mind, "she reads the answer").toBe("reading");
    await errands.finish();
    expect(eris.dataset.mind, "the turn is over").toBeUndefined();
    expect(store.get().erisWindows).toEqual([]);
  });

  it("a line that runs nothing lights no window and sends no spark", async () => {
    windowAt("w1", "endue.mail", { left: 100, top: 300, width: 400, height: 300 });
    const seen: unknown[] = [];
    const off = store.watch(
      (s) => s.erisWindows,
      (lit) => seen.push(...lit),
    );
    const errands = mountErrands(() => shell, ctx);
    errands.ask(Promise.resolve());
    await errands.finish();
    expect(seen).toEqual([]);
    expect(shell.querySelector(".errand, .errand-thread")).toBeNull();
    expect(frames, "she read it").toEqual([READ_MS]);
    off();
  });

  it("the talk line flies into Eris, and she answers once every errand is home", async () => {
    const order: string[] = [];
    const say = vi.fn(async (_text: string, onStep?: (step: BrainStep) => void) => {
      onStep?.(TOOL);
      onStep?.(BACK);
      return { text: "Two new messages." };
    });
    const wm = testWindowManager();
    wm.connect((published) => takeDesk(store, published));
    const talk = Object.assign(ctx, {
      wm,
      runtime: { commands: { list: () => [], has: () => false }, notify: vi.fn() },
      bridge: { brain: { say } },
      keyOf: () => undefined,
      tr: (key: string) => key,
    });
    talk.eris.say = vi.fn(() => order.push("say"));
    const bottom = document.createElement("footer");
    shell.append(bottom);
    const dispose = mountComposer(bottom, talk);
    const input = bottom.querySelector("input") as HTMLInputElement;
    input.focus();
    input.value = "check my mail";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    // Into her body's centre (664, 109) from the input, which jsdom puts at (0, 0).
    const ghost = shell.querySelector<HTMLElement>(".absorb");
    expect(ghost?.style.transform).toContain(
      "translate(calc(-50% + 664.0px), calc(-50% + 109.0px))",
    );
    await vi.waitFor(() =>
      expect(talk.eris.say).toHaveBeenCalledWith("Two new messages.", undefined),
    );
    // The line goes with the desk as the composer sees it (ADR 0109).
    expect(say).toHaveBeenCalledWith(
      "check my mail",
      expect.any(Function),
      expect.objectContaining({ windows: [] }),
    );
    expect(shell.querySelector(".errand")).toBeNull();
    dispose();
  });
});
