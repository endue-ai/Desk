// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrainStep } from "../bridge/types";
import { mountComposer } from "../shell/Composer";
import type { ShellCtx } from "../shell/context";
import { Store, sampleState } from "../shell/state";
import { windowDocs } from "../surface/window-docs";
import type { WindowPages } from "../surface/window-pages";
import { testWindowManager } from "../wm/testing";
import { takeDesk } from "../wm/view";
import { centre, labelOf, mountErrands, nameOf, targetOf, windowOf } from "./errand";
import { LOOK, USE } from "./visiting";

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

  it("finds a local agent's screen in its window's own page, at the window's place (ADR 0201)", () => {
    const page = document.implementation.createHTMLDocument("");
    const screen = at(page.createElement("section"), { left: 0, top: 0, width: 800, height: 600 });
    screen.dataset.surface = "local:claude";
    page.body.append(screen);
    const docs = windowDocs((id) =>
      id === "local:claude" ? { x: 300, y: 100, w: 800, h: 600 } : undefined,
    );
    docs.attach({
      watch: (run: (id: string, win: Window) => () => void) => {
        run("local:claude", { document: page } as unknown as Window);
        return () => {};
      },
    } as unknown as WindowPages);
    at(shell, { left: 0, top: 0, width: 1440, height: 900 });
    const step = { provider: "desk", command: "desk.agents.ask" };
    expect(targetOf(shell, step), "not in the desk's page").toBeNull();
    expect(targetOf(shell, step, docs)).toBe(screen);
    expect(centre(screen, shell, docs)).toEqual({ x: 700, y: 400 });
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

  it("goes to every window that shows the plugin along a thread, and lights each window's frame", async () => {
    const inbox = windowAt("w1", "endue.mail", { left: 100, top: 300, width: 400, height: 300 });
    const draft = windowAt("w2", "endue.mail/draft", {
      left: 800,
      top: 200,
      width: 400,
      height: 200,
    });
    windowAt("w3", "endue.notes", { left: 0, top: 0, width: 90, height: 90 });
    const errands = mountErrands(() => shell, ctx);
    errands.step(TOOL);
    const sparks = [...shell.querySelectorAll<HTMLElement>(".errand")];
    expect(sparks.map((el) => el.style.transform.split(")")[0])).toEqual([
      "translate(300.0px, 450.0px",
      "translate(1000.0px, 300.0px",
    ]);
    // Both windows glow as used, each on its section and in the store the compositor reads.
    expect(store.get().erisWindows).toEqual([
      { id: "w1", glow: USE },
      { id: "w2", glow: USE },
    ]);
    expect(inbox.classList.contains("is-eris-visiting")).toBe(true);
    expect(draft.style.getPropertyValue("--eris-glow")).toBe("1");
    // Each spark runs along a thread from her (664, 109) that lies under it.
    const threads = [...shell.querySelectorAll<SVGSVGElement>(".errand-thread")];
    expect(threads).toHaveLength(2);
    expect(threads[0]?.nextElementSibling).toBe(sparks[0]);
    expect(threads[0]?.querySelector("path")?.getAttribute("d")).toMatch(/^M372\.0 /);
    await vi.waitFor(() => expect(threads.map((t) => t.dataset.leg)).toEqual(["there", "there"]));

    errands.step(BACK);
    await errands.finish();
    expect(shell.querySelector(".errand, .errand-thread")).toBeNull();
    expect(store.get().erisWindows).toEqual([]);
    expect(inbox.classList.contains("is-eris-visiting")).toBe(false);
    expect(store.get().eris.state).toBe("done");
  });

  it("finds the window of a plugin whose section stays in the desk's page (ADR 0201)", () => {
    const plugin = at(document.createElement("section"), { left: 0, top: 0, width: 9, height: 9 });
    plugin.dataset.surface = "endue.mail";
    shell.append(plugin);
    const placed = { id: "w9", plugin: "endue.mail", x: 0, y: 0, w: 9, h: 9, pinned: false };
    store.set((s) => ({ wm: { ...s.wm, windows: { ...s.wm.windows, [s.wm.here]: [placed] } } }));
    mountErrands(() => shell, ctx).step(TOOL);
    expect(store.get().erisWindows).toEqual([{ id: "w9", glow: USE }]);
    expect(plugin.classList.contains("is-eris-visiting"), "the frame glows, not the pane").toBe(
      false,
    );
  });

  it("flies to the window where it is drawn, not to its plugin's place kept in the desk's page", () => {
    // The window lies in a page of its own (ADR 0201): its plugin's section waits in its group.
    const group = document.createElement("div");
    group.className = "surface-anchor";
    group.dataset.window = "w7";
    const place = at(document.createElement("section"), {
      left: 0,
      top: 0,
      width: 1440,
      height: 30,
    });
    place.dataset.surface = "endue.mail";
    group.append(place);
    shell.append(group);
    at(shell, { left: 0, top: 0, width: 1440, height: 900 });
    const front = [{ id: "w7", rect: { x: 500, y: 200, w: 600, h: 400 }, z: 0 }];
    store.set((s) => ({ wm: { ...s.wm, front } }));
    mountErrands(() => shell, ctx).step(TOOL);
    expect(store.get().erisWindows).toEqual([{ id: "w7", glow: USE }]);
    expect(shell.querySelector<HTMLElement>(".errand")?.style.transform).toContain(
      "translate(800.0px, 400.0px)",
    );
  });

  it("looks at the window in use as a line comes in: lit softly until the turn is over", async () => {
    windowAt("w1", "endue.mail", { left: 100, top: 300, width: 400, height: 300 });
    const pane = { view: "plugin:endue.mail" };
    const seen = { x: 0, y: 0, w: 9, h: 9, panes: [pane] };
    const desk = {
      screen: { w: 1440, h: 900 },
      desktops: [{ id: "1", name: "1", current: true }],
      windows: [
        { ...seen, id: "w1", focused: true, desktop: "1" },
        { ...seen, id: "w2", desktop: "1" },
        { ...seen, id: "w4", focused: true, desktop: "2" },
        { ...seen, id: "w5", focused: true, hidden: true },
      ],
    } as unknown as Parameters<ReturnType<typeof mountErrands>["look"]>[0];
    const errands = mountErrands(() => shell, ctx);
    errands.look(desk);
    expect(store.get().erisWindows).toEqual([{ id: "w1", glow: LOOK }]);
    // A bare spark goes to its middle and comes straight back; nobody waits for it.
    const glance = shell.querySelector<HTMLElement>(".errand--look");
    expect(glance?.textContent).toBe("");
    expect(glance?.getAttribute("aria-hidden")).toBe("true");
    expect(shell.querySelector(".errand-thread--look")).not.toBeNull();
    await vi.waitFor(() => expect(shell.querySelector(".errand, .errand-thread")).toBeNull());
    expect(store.get().erisWindows, "she still looks at it").toEqual([{ id: "w1", glow: LOOK }]);

    // Used meanwhile it glows fully, and softly again once the errand is home.
    errands.step(TOOL);
    expect(store.get().erisWindows).toEqual([{ id: "w1", glow: USE }]);
    errands.step(BACK);
    await vi.waitFor(() => expect(store.get().erisWindows).toEqual([{ id: "w1", glow: LOOK }]));
    await errands.finish();
    expect(store.get().erisWindows).toEqual([]);

    // An answer that comes at once leaves the window lit until the look's spark is back.
    errands.look(desk);
    await errands.finish();
    expect(store.get().erisWindows).toEqual([{ id: "w1", glow: LOOK }]);
    await vi.waitFor(() => expect(store.get().erisWindows).toEqual([]));
    expect(shell.querySelector(".errand, .errand-thread")).toBeNull();
  });

  it("with reduced motion the windows light up, the label waits beside her and no thread is laid", async () => {
    ctx.reduced = () => true;
    windowAt("w1", "endue.mail", { left: 100, top: 300, width: 400, height: 300 });
    const errands = mountErrands(() => shell, ctx);
    errands.look({ screen: { w: 1, h: 1 }, windows: [{ id: "w1", focused: true }] } as never);
    expect(shell.querySelector(".errand"), "a look moves nothing").toBeNull();
    errands.step(TOOL);
    expect(shell.querySelector<HTMLElement>(".errand")?.style.transform).toContain(
      "translate(814.0px, 73.0px)",
    );
    expect(shell.querySelector(".errand-thread")).toBeNull();
    expect(store.get().erisWindows).toEqual([{ id: "w1", glow: USE }]);
    errands.step(BACK);
    await errands.finish();
    expect(store.get().erisWindows).toEqual([]);
  });

  it("a desk that goes takes its sparks, threads and lights with it", async () => {
    windowAt("w1", "endue.mail", { left: 100, top: 300, width: 400, height: 300 });
    const errands = mountErrands(() => shell, ctx);
    errands.step(TOOL);
    errands.dispose();
    expect(shell.querySelector(".errand, .errand-thread")).toBeNull();
    await vi.waitFor(() => expect(store.get().erisWindows).toEqual([]));
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
