// @vitest-environment jsdom
// Not responding (#39) on the runtime itself: the browser stub's core, plugin frames played by the
// test (they say hello and answer pings as the SDK does, until told to stop), and fake timers.
import type { PluginManifest } from "@endue-ai/bridge";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserCore } from "../bridge/core";
import { createRuntime } from "../runtime";

type Message = { type: string; [field: string]: unknown };

const centre = (id: string): PluginManifest => ({
  id,
  version: "0.1.0",
  kind: "ui",
  entry: "ui/index.html",
  surfaces: [{ id: "main", title: id.toUpperCase(), placement: "center" }],
  contributes: { commands: [{ id: `${id}.hello`, title: "Hello" }] },
});

/** One plugin's frame, played by the test: it answers each ping until `silent`. */
class Plugin {
  messages: Message[] = [];
  silent = false;
  /** When it last answered a ping. */
  answeredAt = Number.NaN;

  constructor(
    readonly id: string,
    readonly root: HTMLElement,
  ) {}

  section(): HTMLElement | null {
    return this.root.querySelector(`[data-surface="${this.id}"]`);
  }

  frame(): HTMLIFrameElement | null {
    return this.section()?.querySelector("iframe") ?? null;
  }

  overlay(): HTMLElement | null {
    return this.section()?.querySelector(".desk-not-responding") ?? null;
  }

  button(name: string): HTMLButtonElement | undefined {
    const buttons = [...(this.section()?.querySelectorAll("button") ?? [])];
    return buttons.find((b) => b.textContent === name);
  }

  /** Its page loaded: listen as the SDK does and say hello. */
  connect(): void {
    const win = this.frame()?.contentWindow;
    if (!win) throw new Error(`${this.id} has no frame`);
    win.addEventListener("message", (event) => this.#heard(event.data as Message));
    this.send({ type: "desk:hello" });
  }

  send(data: Message): void {
    const source = this.frame()?.contentWindow;
    if (!source) throw new Error(`${this.id} has no frame`);
    window.dispatchEvent(new MessageEvent("message", { data, source }));
  }

  #heard(message: Message): void {
    this.messages.push(message);
    if (message.type !== "desk:ping" || this.silent) return;
    this.answeredAt = performance.now();
    this.send({ type: "desk:pong", n: message.n as number });
  }
}

/** Let `ms` pass, then let what it set off settle: messages to frames go by timer in jsdom. */
async function flush(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
}

async function desk(ids: string[], silent = false) {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"],
  });
  const root = document.createElement("div");
  document.body.replaceChildren(root);
  const core = browserCore({ manifests: ids.map(centre) });
  const runtime = createRuntime({
    root,
    bridge: core.client,
    language: "en",
    plugins: { url: (id, path, revision) => `/plugins/${id}/${path}?v=${revision}` },
  });
  let started = false;
  void runtime.plugins?.ready.then(() => {
    started = true;
  });
  for (let i = 0; i < 50 && !started; i++) await flush(10);
  const plugins = ids.map((id) => new Plugin(id, root));
  for (const plugin of plugins) {
    plugin.silent = silent;
    plugin.connect();
  }
  // The first ping after hello, answered: every frame is watched from here.
  await flush(2000);
  return { runtime, plugins };
}

/** Go silent and let time run to `ms` after the plugin's last answer. */
async function silence(plugin: Plugin, ms: number): Promise<void> {
  plugin.silent = true;
  await flush(plugin.answeredAt + ms - performance.now());
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("a plugin frame that stops answering", () => {
  it("shows Not responding with Wait and Stop on its own window only, 5 s after its last answer", async () => {
    const { runtime, plugins } = await desk(["a.one", "b.two"]);
    const [a, b] = plugins as [Plugin, Plugin];
    expect(a.section()?.dataset.responding).toBe("responding");
    await silence(a, 4999);
    expect(a.overlay()).toBeNull();
    await flush(1);
    expect(a.overlay()?.getAttribute("role")).toBe("alertdialog");
    expect(a.overlay()?.textContent).toContain("Not responding");
    expect(a.overlay()?.textContent).toContain("A.ONE has not answered for 5 seconds.");
    expect(a.button("Wait")).toBeDefined();
    expect(a.button("Stop")).toBeDefined();
    expect(a.section()?.dataset.responding).toBe("late");
    expect(runtime.frames.state("a.one")).toBe("late");
    expect(b.overlay()).toBeNull();
    expect(runtime.frames.state("b.two")).toBe("responding");
    // Answering again takes it away.
    a.silent = false;
    await flush(2000);
    expect(a.overlay()).toBeNull();
    expect(runtime.frames.state("a.one")).toBe("responding");
  });

  it("Wait takes the question away for 10 s, and it comes back while the frame stays silent", async () => {
    const { plugins } = await desk(["a.one"]);
    const [a] = plugins as [Plugin];
    await silence(a, 5000);
    a.button("Wait")?.click();
    expect(a.overlay()).toBeNull();
    await flush(9999);
    expect(a.overlay()).toBeNull();
    await flush(1);
    expect(a.overlay()).not.toBeNull();
  });

  it("Stop unloads it to a placeholder with Reload; Reload loads it with its last desk:state", async () => {
    const { runtime, plugins } = await desk(["a.one"]);
    const [a] = plugins as [Plugin];
    a.send({ type: "desk:state", state: { count: 5 } });
    await silence(a, 5000);
    a.button("Stop")?.click();
    await flush();
    expect(a.frame()).toBeNull();
    expect(a.overlay()).toBeNull();
    const stand = a.section()?.querySelector(".desk-surface-placeholder--stopped");
    expect(stand?.textContent).toContain("Stopped because it was not responding.");
    expect(runtime.frames.state("a.one")).toBe("stopped");
    expect(a.section()?.dataset.responding).toBe("stopped");
    // In sight, it stays unloaded: only Reload loads it.
    await flush(60_000);
    expect(a.frame()).toBeNull();
    expect(runtime.plugins?.mounted()).toEqual(["a.one"]);

    a.button("Reload")?.click();
    await flush();
    expect(a.frame()).not.toBeNull();
    expect(runtime.frames.state("a.one")).toBe("responding");
    expect(a.section()?.dataset.responding).toBeUndefined();
    a.messages = [];
    a.silent = false;
    a.connect();
    await flush();
    expect(a.messages.filter((m) => m.type === "desk:init")).toEqual([
      { type: "desk:init", pluginId: "a.one", state: { count: 5 } },
    ]);
    await flush(2000);
    expect(a.section()?.dataset.responding).toBe("responding");
  });

  it("stopped, its frame does not load for a command: the command is refused until Reload", async () => {
    const { runtime, plugins } = await desk(["a.one"]);
    const [a] = plugins as [Plugin];
    await silence(a, 5000);
    a.button("Stop")?.click();
    await flush();
    const ran = runtime.commands.run("a.one.hello").catch((error: Error) => error.message);
    await flush();
    expect(await ran).toBe("a.one.hello: a.one is asleep and its frame cannot load");
    expect(a.frame()).toBeNull();
    expect(runtime.frames.state("a.one")).toBe("stopped");
  });

  it("agents wait, stop and reload it with desk.frames.*, refused for a frame in another state", async () => {
    const { runtime, plugins } = await desk(["a.one"]);
    const [a] = plugins as [Plugin];
    const run = (act: string) => runtime.commands.run(`desk.frames.${act}`, { plugin: "a.one" });
    await expect(run("stop")).rejects.toThrow("a.one is not a window that is not responding");
    await expect(run("reload")).rejects.toThrow("a.one is neither stopped nor asleep");
    await expect(
      runtime.commands.run("desk.frames.stop", { plugin: "nobody.here" }),
    ).rejects.toThrow("nobody.here has no window the desk watches");
    await silence(a, 5000);
    await expect(run("wait")).resolves.toBe("late");
    expect(a.overlay()).toBeNull();
    await flush(10_000);
    await expect(run("stop")).resolves.toBe("stopped");
    expect(a.frame()).toBeNull();
    await expect(run("reload")).resolves.toBe("responding");
    expect(a.frame()).not.toBeNull();
  });

  it("never flags a frame that has not answered a ping: its SDK may be older than the ping", async () => {
    const { runtime, plugins } = await desk(["a.one"], true);
    const [a] = plugins as [Plugin];
    await flush(60_000);
    // Three pings, then none: it is let be until its next hello.
    expect(a.messages.filter((m) => m.type === "desk:ping").length).toBe(3);
    expect(a.overlay()).toBeNull();
    expect(a.section()?.dataset.responding).toBeUndefined();
    expect(runtime.frames.state("a.one")).toBe("responding");
  });
});

describe("a plugin frame whose renderer died (#44)", () => {
  it("loads again by itself with its last desk:state, and the other windows never notice", async () => {
    const { runtime, plugins } = await desk(["a.one", "b.two"]);
    const [a, b] = plugins as [Plugin, Plugin];
    a.send({ type: "desk:state", state: { count: 7 } });
    const before = b.frame();
    expect(runtime.frames.crashed("a.one")).toBe(true);
    await flush();
    expect(a.frame()).not.toBeNull();
    expect(runtime.frames.state("a.one")).toBe("responding");
    a.messages = [];
    a.connect();
    await flush();
    expect(a.messages.filter((m) => m.type === "desk:init")).toEqual([
      { type: "desk:init", pluginId: "a.one", state: { count: 7 } },
    ]);
    expect(b.frame()).toBe(before);
    expect(runtime.frames.state("b.two")).toBe("responding");
  });

  it("a second death within a minute holds it stopped with Reload; the person's Reload frees it", async () => {
    const { runtime, plugins } = await desk(["a.one"]);
    const [a] = plugins as [Plugin];
    runtime.frames.crashed("a.one");
    await flush();
    a.connect();
    await flush(30_000);
    expect(runtime.frames.crashed("a.one")).toBe(true);
    await flush();
    expect(a.frame()).toBeNull();
    expect(runtime.frames.state("a.one")).toBe("stopped");
    const stand = a.section()?.querySelector(".desk-surface-placeholder--stopped");
    expect(stand?.textContent).toContain("It stopped twice within a minute");
    // Held: it stays down however long it is in sight.
    await flush(120_000);
    expect(a.frame()).toBeNull();
    a.button("Reload")?.click();
    await flush();
    expect(a.frame()).not.toBeNull();
    a.connect();
    await flush(2000);
    // Freed: the next death reloads by itself again.
    expect(runtime.frames.crashed("a.one")).toBe(true);
    await flush();
    expect(a.frame()).not.toBeNull();
  });

  it("is refused for a surface the desk does not watch, or one already stopped", async () => {
    const { runtime, plugins } = await desk(["a.one"]);
    const [a] = plugins as [Plugin];
    expect(runtime.frames.crashed("nobody.here")).toBe(false);
    await silence(a, 5000);
    a.button("Stop")?.click();
    await flush();
    expect(runtime.frames.crashed("a.one")).toBe(false);
  });
});
