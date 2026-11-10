// @vitest-environment jsdom
// A plugin's last desk:state across a hot reload, on the runtime itself: the browser stub's core,
// plugin frames played by the test, and fake timers. Each frame's messages are in flight until the
// desk's thread gets to them, in the order the frame posted them, as in a browser; one that answers
// pings as the SDK does (`plugin-sdk/src/ping.ts`) gets them there first. When a frame's page has gone,
// what is still in flight arrives with no `source`, as Chromium hands it (#32 Stage 1, #75's finding).
import type { BridgeEvent, PluginManifest } from "@endue-ai/bridge";
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
});

/** One plugin's frame, played by the test. */
class Plugin {
  messages: Message[] = [];
  /** It answers pings, as the SDK does; false for a page that takes no messages. */
  answers = true;
  /** What its page posted that the desk has not got to yet, in order. */
  readonly #flight: Message[] = [];
  #off: (() => void) | undefined;

  constructor(
    readonly id: string,
    readonly root: HTMLElement,
  ) {}

  frame(): HTMLIFrameElement | null {
    return this.root.querySelector(`[data-surface="${this.id}"] iframe`);
  }

  /** Its page loaded: listen as the SDK does and say hello. */
  connect(): void {
    const win = this.frame()?.contentWindow;
    if (!win) throw new Error(`${this.id} has no frame`);
    this.#off?.();
    const heard = (event: MessageEvent) => this.#heard(event.data as Message);
    win.addEventListener("message", heard);
    this.#off = () => win.removeEventListener("message", heard);
    this.send({ type: "desk:hello" });
  }

  /** Post a message the desk gets at once. */
  send(data: Message): void {
    this.#flight.push(data);
    this.arrive(this.frame()?.contentWindow ?? null);
  }

  /** Post a message that stays in flight until the desk gets to it. */
  post(data: Message): void {
    this.#flight.push(data);
  }

  /** The desk gets to what is in flight; `null` once the page that posted it has gone. */
  arrive(source: Window | null): void {
    for (const data of this.#flight.splice(0))
      window.dispatchEvent(new MessageEvent("message", { data, source }));
  }

  inits(): Message[] {
    return this.messages.filter((m) => m.type === "desk:init");
  }

  #heard(message: Message): void {
    this.messages.push(message);
    if (message.type === "desk:ping" && this.answers)
      this.send({ type: "desk:pong", n: message.n as number });
  }
}

/** Let `ms` pass, then let what it set off settle: messages to frames go by timer in jsdom. */
async function flush(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
}

async function desk(ids: string[]) {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"],
  });
  const root = document.createElement("div");
  document.body.replaceChildren(root);
  const core = browserCore({ manifests: ids.map(centre) });
  const runtime = createRuntime({
    root,
    bridge: core.client,
    plugins: { url: (id, path, revision) => `/plugins/${id}/${path}?v=${revision}` },
  });
  let started = false;
  void runtime.plugins?.ready.then(() => {
    started = true;
  });
  for (let i = 0; i < 50 && !started; i++) await flush(10);
  const plugins = ids.map((id) => new Plugin(id, root));
  for (const plugin of plugins) plugin.connect();
  await flush();
  /** The plugin's files changed: the core says so, as its watcher does. */
  const update = (id: string, revision: number) =>
    core.stub.emit({
      event: "plugin.changed",
      data: { plugin: id, change: "updated", revision },
    } as BridgeEvent);
  return { plugins, update };
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("a plugin's last desk:state across a reload", () => {
  it("comes back when the plugin set it just before the update, before the desk got to it", async () => {
    const { plugins, update } = await desk(["a.one"]);
    const [a] = plugins as [Plugin];
    a.send({ type: "desk:state", state: { count: 1 } });
    a.post({ type: "desk:state", state: { count: 2 } });
    update("a.one", 2);
    await flush();
    expect(a.frame()?.src).toContain("v=2");
    // The page that posted it has gone: whatever is still in flight comes with no source.
    a.arrive(null);
    a.messages = [];
    a.connect();
    await flush();
    expect(a.inits()).toEqual([{ type: "desk:init", pluginId: "a.one", state: { count: 2 } }]);
  });

  it("a frame that takes no messages still reloads, with the state that had arrived", async () => {
    const { plugins, update } = await desk(["a.one"]);
    const [a] = plugins as [Plugin];
    a.answers = false;
    a.send({ type: "desk:state", state: { count: 1 } });
    update("a.one", 2);
    await flush(500);
    expect(a.frame()?.src).toContain("v=2");
    a.answers = true;
    a.messages = [];
    a.connect();
    await flush();
    expect(a.inits()).toEqual([{ type: "desk:init", pluginId: "a.one", state: { count: 1 } }]);
  });

  it("never takes a desk:state that comes with no source, for the plugin reloaded or any other", async () => {
    const { plugins, update } = await desk(["a.one", "b.two"]);
    const [a, b] = plugins as [Plugin, Plugin];
    a.send({ type: "desk:state", state: { mine: "a" } });
    b.send({ type: "desk:state", state: { mine: "b" } });
    update("a.one", 2);
    // Sent by nobody the desk can tell: neither plugin's state, whoever reloaded just now.
    window.dispatchEvent(
      new MessageEvent("message", { data: { type: "desk:state", state: { forged: true } } }),
    );
    await flush();
    expect(a.frame()?.src).toContain("v=2");
    update("b.two", 2);
    await flush();
    for (const plugin of [a, b]) {
      plugin.messages = [];
      plugin.connect();
    }
    await flush();
    expect(a.inits()).toEqual([{ type: "desk:init", pluginId: "a.one", state: { mine: "a" } }]);
    expect(b.inits()).toEqual([{ type: "desk:init", pluginId: "b.two", state: { mine: "b" } }]);
  });
});
