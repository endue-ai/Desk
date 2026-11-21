// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrainStep } from "../bridge/types";
import type { ShellCtx } from "../shell/context";
import { Store, sampleState } from "../shell/state";
import { windowDocs } from "../surface/window-docs";
import type { WindowPages } from "../surface/window-pages";
import { centre, DWELL_MS, labelOf, mountErrands, nameOf, targetOf, windowOf } from "./errand";
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

  /** The first spark on the desk, once its errand is drawn: after the line is in her and read. */
  const drawn = async () => {
    await vi.waitFor(() => expect(shell.querySelector(".errand")).not.toBeNull());
    return shell.querySelector<HTMLElement>(".errand");
  };

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
    expect(store.get().eris.state).toBe("thinking");
    const errand = await drawn();
    expect(errand?.dataset.provider).toBe("endue.mail");
    expect(errand?.textContent).toBe("MailLatest mail");
    // The spark ends the outbound leg on the window's centre (300, 450), and the window glows
    // once it is there.
    expect(errand?.style.transform).toContain("translate(300.0px, 450.0px)");
    await vi.waitFor(() => expect(errand?.dataset.leg).toBe("there"));
    expect(mail.classList.contains("is-eris-visiting")).toBe(true);

    errands.step(BACK);
    await errands.finish();
    expect(shell.querySelector(".errand")).toBeNull();
    expect(mail.classList.contains("is-eris-visiting")).toBe(false);
    // She has the answer and reads it until her reply comes. Out, a stay at the window, home.
    expect(store.get().eris.state).toBe("thinking");
    expect(frames).toEqual([640, DWELL_MS, 640]);
  });

  it("waits beside Eris for a plugin without a window, and an unanswered errand comes back empty", async () => {
    const errands = mountErrands(() => shell, ctx);
    errands.step(TOOL);
    // Beside her body's centre (664, 109): 150 px right and 36 px up.
    expect((await drawn())?.style.transform).toContain("translate(814.0px, 73.0px)");
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
    expect(frames).toEqual([0, 0, 0]);
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
    await drawn();
    const sparks = [...shell.querySelectorAll<HTMLElement>(".errand")];
    expect(sparks.map((el) => el.style.transform.split(")")[0])).toEqual([
      "translate(300.0px, 450.0px",
      "translate(1000.0px, 300.0px",
    ]);
    // Both windows glow as used once their sparks land, each on its section and in the store the
    // compositor reads.
    await vi.waitFor(() =>
      expect(store.get().erisWindows).toEqual([
        { id: "w1", glow: USE },
        { id: "w2", glow: USE },
      ]),
    );
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
    expect(store.get().eris.state).toBe("thinking");
  });

  it("finds the window of a plugin whose section stays in the desk's page (ADR 0201)", async () => {
    const plugin = at(document.createElement("section"), { left: 0, top: 0, width: 9, height: 9 });
    plugin.dataset.surface = "endue.mail";
    shell.append(plugin);
    const placed = { id: "w9", plugin: "endue.mail", x: 0, y: 0, w: 9, h: 9, pinned: false };
    store.set((s) => ({ wm: { ...s.wm, windows: { ...s.wm.windows, [s.wm.here]: [placed] } } }));
    mountErrands(() => shell, ctx).step(TOOL);
    await vi.waitFor(() => expect(store.get().erisWindows).toEqual([{ id: "w9", glow: USE }]));
    expect(plugin.classList.contains("is-eris-visiting"), "the frame glows, not the pane").toBe(
      false,
    );
  });

  it("flies to the window where it is drawn, not to its plugin's place kept in the desk's page", async () => {
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
    expect((await drawn())?.style.transform).toContain("translate(800.0px, 400.0px)");
    await vi.waitFor(() => expect(store.get().erisWindows).toEqual([{ id: "w7", glow: USE }]));
  });

  it("finds a plugin's window the window manager places whose page this one cannot read (the app)", async () => {
    at(shell, { left: 0, top: 0, width: 1440, height: 900 });
    const placed = { id: "w5", plugin: "endue.mail", x: 0, y: 0, w: 9, h: 9, pinned: false };
    const front = [{ id: "w5", rect: { x: 200, y: 100, w: 400, h: 300 }, z: 0 }];
    store.set((s) => ({
      wm: { ...s.wm, front, windows: { ...s.wm.windows, [s.wm.here]: [placed] } },
    }));
    mountErrands(() => shell, ctx).step(TOOL);
    // To the middle of where the window is drawn, and lit once the spark is there.
    expect((await drawn())?.style.transform).toContain("translate(400.0px, 250.0px)");
    await vi.waitFor(() => expect(store.get().erisWindows).toEqual([{ id: "w5", glow: USE }]));
  });

  it("with reduced motion the windows light up, the label waits beside her and no thread is laid", async () => {
    ctx.reduced = () => true;
    windowAt("w1", "endue.mail", { left: 100, top: 300, width: 400, height: 300 });
    const errands = mountErrands(() => shell, ctx);
    errands.ask(Promise.resolve());
    errands.step(TOOL);
    expect((await drawn())?.style.transform).toContain("translate(814.0px, 73.0px)");
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
    await drawn();
    errands.dispose();
    expect(shell.querySelector(".errand, .errand-thread")).toBeNull();
    await vi.waitFor(() => expect(store.get().erisWindows).toEqual([]));
  });
});
