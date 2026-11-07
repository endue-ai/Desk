// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrainStep } from "../bridge/types";
import { mountComposer } from "../shell/Composer";
import type { ShellCtx } from "../shell/context";
import { Store, sampleState } from "../shell/state";
import { labelOf, mountErrands, nameOf, targetOf, windowOf } from "./errand";

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

describe("Eris's errands", () => {
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

  it("names a plugin as people read it", () => {
    expect(nameOf("endue.mail")).toBe("Mail");
    expect(nameOf("example.tool-box")).toBe("Tool Box");
    expect(nameOf("desk")).toBe("Desk");
  });

  it("finds the plugin's window on screen and skips hidden ones and others' windows", () => {
    const other = at(document.createElement("section"), { left: 0, top: 0, width: 9, height: 9 });
    other.dataset.surface = "endue.mailbox";
    const hidden = document.createElement("section");
    hidden.dataset.surface = "endue.mail";
    const mail = at(document.createElement("section"), {
      left: 100,
      top: 300,
      width: 400,
      height: 300,
    });
    mail.dataset.surface = "endue.mail/main";
    shell.append(other, hidden, mail);
    expect(windowOf(shell, "endue.mail")).toBe(mail);
    expect(windowOf(shell, "endue.notes")).toBeNull();
  });

  it("sends a local agent tool to the agent's screen, else to the agent bar's group", () => {
    const step = { provider: "desk", command: "desk.agents.ask" };
    const group = at(document.createElement("div"), { left: 0, top: 200, width: 40, height: 90 });
    group.dataset.localAgents = "";
    shell.append(group);
    expect(targetOf(shell, step)).toBe(group);
    const screen = at(document.createElement("section"), {
      left: 300,
      top: 100,
      width: 800,
      height: 600,
    });
    screen.dataset.surface = "local:claude";
    shell.append(screen);
    expect(targetOf(shell, step)).toBe(screen);
    expect(labelOf(step)).toBe("Agents");
    expect(labelOf(TOOL)).toBe("Mail");
    expect(targetOf(shell, TOOL)).toBeNull();
  });

  it("flies from Eris to the plugin's window, which glows until the spark flies home", async () => {
    const mail = at(document.createElement("section"), {
      left: 100,
      top: 300,
      width: 400,
      height: 300,
    });
    mail.dataset.surface = "endue.mail";
    shell.append(mail);
    const errands = mountErrands(() => shell, ctx);
    errands.step(TOOL);
    const errand = shell.querySelector<HTMLElement>(".errand");
    expect(errand?.dataset.provider).toBe("endue.mail");
    expect(errand?.textContent).toBe("MailLatest mail");
    expect(mail.classList.contains("is-eris-visiting")).toBe(true);
    expect(store.get().eris.state).toBe("thinking");
    // The spark ends the outbound leg on the window's centre (300, 450).
    expect(errand?.style.transform).toContain("translate(300.0px, 450.0px)");
    await vi.waitFor(() => expect(errand?.dataset.leg).toBe("there"));

    errands.step(BACK);
    await errands.finish();
    expect(shell.querySelector(".errand")).toBeNull();
    expect(mail.classList.contains("is-eris-visiting")).toBe(false);
    expect(store.get().eris.state).toBe("done");
    expect(frames).toEqual([640, 640]);
  });

  it("waits beside Eris for a plugin without a window, and an unanswered errand comes back empty", async () => {
    const errands = mountErrands(() => shell, ctx);
    errands.step(TOOL);
    // Beside her body's centre (664, 109): 150 px right and 36 px up.
    expect(shell.querySelector<HTMLElement>(".errand")?.style.transform).toContain(
      "translate(814.0px, 73.0px)",
    );
    await errands.finish();
    expect(shell.querySelector(".errand")).toBeNull();
    expect(store.get().eris.state).toBe("oops");
  });

  it("moves nothing with reduced motion", async () => {
    ctx.reduced = () => true;
    const errands = mountErrands(() => shell, ctx);
    errands.step(TOOL);
    errands.step(BACK);
    await errands.finish();
    expect(frames).toEqual([0, 0]);
  });

  it("the talk line flies into Eris, and she answers once every errand is home", async () => {
    const order: string[] = [];
    const say = vi.fn(async (_text: string, onStep?: (step: BrainStep) => void) => {
      onStep?.(TOOL);
      onStep?.(BACK);
      return { text: "Two new messages." };
    });
    const talk = Object.assign(ctx, {
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
    expect(say).toHaveBeenCalledWith("check my mail", expect.any(Function));
    expect(shell.querySelector(".errand")).toBeNull();
    dispose();
  });
});
