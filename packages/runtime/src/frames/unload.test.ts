// @vitest-environment jsdom
// Hidden surfaces are unloaded and their state kept (ADR 0070), on the runtime itself: the browser
// stub's core, plugin frames played by the test (they say hello and answer as the SDK would), and
// fake timers for desk.display.unload-after.
import type { PluginManifest } from "@endue-ai/bridge";
import { afterEach, describe, expect, it, vi } from "vitest";
import display from "../../../../plugins/display/plugin.json";
import { browserCore } from "../bridge/core";
import { createRuntime } from "../runtime";

const UNLOAD = "desk.display.unload-after";
const LIVE = "desk.display.live-surfaces";
const STATE = "ui.surface.state";

type Message = { type: string; name?: string; call?: number; [field: string]: unknown };
/** How a plugin answers ui.surface.state: as the SDK with a provider, without one, too much, or not at all. */
type Answer = "state" | "refuse" | "big" | "silent";

const centre = (id: string): PluginManifest => ({
  id,
  version: "0.1.0",
  kind: "ui",
  entry: "ui/index.html",
  surfaces: [{ id: "main", title: id.toUpperCase(), placement: "center" }],
});

/** One plugin's frame, played by the test: what the runtime posted to it, and its answers. */
class Plugin {
  messages: Message[] = [];
  answer: Answer = "state";
  kept: unknown = { count: 3 };

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

  inits(): Message[] {
    return this.messages.filter((m) => m.type === "desk:init");
  }

  asked(): Message[] {
    return this.messages.filter((m) => m.type === "desk:command" && m.name === STATE);
  }

  #heard(message: Message): void {
    this.messages.push(message);
    if (message.type !== "desk:command" || message.name !== STATE) return;
    const call = message.call;
    if (this.answer === "silent") return;
    if (this.answer === "refuse") {
      const error = { code: "unknown_command", message: "no handler" };
      this.send({ type: "desk:reply", call, ok: false, error });
      return;
    }
    const state = this.answer === "big" ? { text: "x".repeat(70 * 1024) } : this.kept;
    this.send({ type: "desk:reply", call, ok: true, result: { state } });
  }
}

/** Let `ms` pass, then let what it set off settle: messages to frames go by timer in jsdom. */
async function flush(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
}

async function desk(ids: string[], settings: Record<string, unknown> = {}) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const root = document.createElement("div");
  document.body.replaceChildren(root);
  // desk.display brings desk.display.show and the two settings' defaults.
  const manifests = [display as PluginManifest, ...ids.map(centre)];
  const core = browserCore({ manifests, init: { settings } });
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
  const plugins = Object.fromEntries(ids.map((id) => [id, new Plugin(id, root)]));
  for (const plugin of Object.values(plugins)) plugin.connect();
  await flush();
  const hide = async (id: string) => {
    plugins[id]?.send({ type: "desk:visible", visible: false });
    await flush();
  };
  const show = async (id: string) => {
    await runtime.commands.run("desk.display.show", { plugin: id });
    await flush();
  };
  const unloaded = (id: string) =>
    plugins[id]?.frame() === null &&
    plugins[id]?.section()?.querySelector(".desk-surface-placeholder") !== null;
  return { runtime, core, plugins, hide, show, unloaded };
}

/** What a browser does when a frame's page focuses one of its elements (jsdom leaves the events out). */
function takeFocus(frame: HTMLIFrameElement | null | undefined): void {
  if (!frame) throw new Error("no frame");
  frame.focus();
  frame.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("hidden surfaces are unloaded and their state kept", () => {
  it("a centre surface hidden longer than unload-after is asked for its state and unloaded to a placeholder; its cell, the focus and the buffer list stay", async () => {
    const d = await desk(["a.one", "b.two"], { [UNLOAD]: 60 });
    d.runtime.focusSurface("a.one");
    await d.hide("b.two");
    const layout = d.runtime.layout();
    const buffers = d.runtime.buffers.list().map((b) => b.id);
    await flush(59_000);
    expect(d.plugins["b.two"]?.asked()).toEqual([]);
    expect(d.unloaded("b.two")).toBe(false);

    await flush(1_000);
    expect(d.plugins["b.two"]?.asked()).toMatchObject([{ args: { surface: "main" } }]);
    expect(d.unloaded("b.two")).toBe(true);
    expect(d.plugins["b.two"]?.section()?.textContent).toContain("B.TWO");
    expect(d.unloaded("a.one")).toBe(false);
    expect(d.runtime.layout()).toEqual(layout);
    expect(d.runtime.shortcuts.focused).toBe("a.one");
    expect(d.runtime.buffers.list().map((b) => b.id)).toEqual(buffers);
    expect(d.runtime.plugins?.mounted()).toEqual(["a.one", "b.two"]);
  });

  it("shown again it remounts, and its init hands back the kept state; ctx.state still comes back", async () => {
    const d = await desk(["a.one", "b.two"], { [UNLOAD]: 60 });
    const b = d.plugins["b.two"];
    if (!b) throw new Error("no b.two");
    b.send({ type: "desk:state", state: { saved: true } });
    await d.hide("b.two");
    await flush(60_000);
    expect(d.unloaded("b.two")).toBe(true);

    await d.show("b.two");
    expect(d.unloaded("b.two")).toBe(false);
    expect(b.frame()).not.toBeNull();
    b.messages = [];
    b.connect();
    await flush();
    expect(b.inits()).toEqual([
      { type: "desk:init", pluginId: "b.two", state: { saved: true }, restored: { count: 3 } },
    ]);
  });

  it("a plugin that does not answer, answers unknown_command or more than 64 KiB comes back cold", async () => {
    const ids = ["a.silent", "b.refuse", "c.big"];
    const d = await desk(ids, { [UNLOAD]: 60 });
    const answers: Answer[] = ["silent", "refuse", "big"];
    ids.forEach((id, i) => {
      const plugin = d.plugins[id];
      if (plugin) plugin.answer = answers[i] ?? "state";
    });
    for (const id of ids) await d.hide(id);
    await flush(60_000);
    // The silent one is given two seconds to answer, then unloaded all the same.
    expect(d.unloaded("a.silent")).toBe(false);
    await flush(2_000);
    for (const id of ids) expect(d.unloaded(id)).toBe(true);

    for (const id of ids) {
      await d.show(id);
      const plugin = d.plugins[id];
      if (!plugin) throw new Error(`no ${id}`);
      plugin.messages = [];
      plugin.connect();
      await flush();
      expect(plugin.inits()).toEqual([{ type: "desk:init", pluginId: id }]);
    }
  });

  it("past live-surfaces the surface hidden longest is unloaded at once, and visible ones never are", async () => {
    const d = await desk(["a.one", "b.two", "c.three"], { [UNLOAD]: 3600, [LIVE]: 2 });
    expect(["a.one", "b.two", "c.three"].map(d.unloaded)).toEqual([false, false, false]);
    await d.hide("a.one");
    await flush(5_000);
    await d.hide("b.two");
    await flush();
    expect(d.unloaded("a.one")).toBe(true);
    expect(d.unloaded("b.two")).toBe(false);
    expect(d.unloaded("c.three")).toBe(false);

    // A tighter cap at run time takes effect at once; the visible one stays whatever the cap.
    d.runtime.settings.set(LIVE, 1);
    await flush();
    expect(d.unloaded("b.two")).toBe(true);
    await d.show("a.one");
    expect(d.unloaded("a.one")).toBe(false);
    expect(d.unloaded("c.three")).toBe(false);
  });

  it("a frame that focuses itself as it loads again does not take the focus from where it is", async () => {
    const d = await desk(["a.one", "b.two"], { [UNLOAD]: 60 });
    d.runtime.focusSurface("a.one");
    const before = document.activeElement;
    await d.hide("b.two");
    await flush(60_000);
    expect(d.unloaded("b.two")).toBe(true);

    // A request loads it again out of sight; as it mounts it focuses its view, as many plugins do.
    d.runtime.plugins?.command("b.two", "desk.buffers.show", { buffer: "x" });
    await flush();
    takeFocus(d.plugins["b.two"]?.frame());
    expect(document.activeElement).toBe(before);
    expect(d.runtime.shortcuts.focused).toBe("a.one");

    // Browsers that only blur the desk's window are heard too.
    d.plugins["b.two"]?.frame()?.focus();
    window.dispatchEvent(new FocusEvent("blur"));
    await flush();
    expect(document.activeElement).toBe(before);

    // Once the person points at it, they can move into it as into any frame.
    d.plugins["b.two"]?.frame()?.dispatchEvent(new PointerEvent("pointerover"));
    takeFocus(d.plugins["b.two"]?.frame());
    expect(document.activeElement).toBe(d.plugins["b.two"]?.frame());
    expect(d.runtime.shortcuts.focused).toBe("b.two");
  });

  it("0 keeps hidden surfaces loaded and sets no cap", async () => {
    const d = await desk(["a.one", "b.two"], { [UNLOAD]: 0, [LIVE]: 0 });
    await d.hide("a.one");
    await d.hide("b.two");
    await flush(24 * 3_600_000);
    expect(d.unloaded("a.one")).toBe(false);
    expect(d.unloaded("b.two")).toBe(false);
  });

  it("a request to an unloaded plugin loads its frame again and arrives after its hello; the plugin stays mounted and on", async () => {
    const d = await desk(["a.one", "b.two"], { [UNLOAD]: 60 });
    await d.hide("b.two");
    await flush(60_000);
    expect(d.unloaded("b.two")).toBe(true);

    d.runtime.plugins?.command("b.two", "desk.buffers.show", { buffer: "x" });
    await flush();
    const b = d.plugins["b.two"];
    if (!b) throw new Error("no b.two");
    expect(b.frame()).not.toBeNull();
    b.messages = [];
    b.connect();
    await flush();
    // Its init first, the theme every plugin gets, then what waited for it.
    const heard = b.messages.map((m) => m.name ?? m.type).filter((m) => m !== "desk:theme");
    expect(heard).toEqual(["desk:init", "desk.buffers.show"]);
    expect(d.runtime.plugins?.mounted()).toEqual(["a.one", "b.two"]);
    expect(d.core.plugins.find((p) => p.id === "b.two")?.enabled).toBe(true);
    const methods = d.core.stub.log.map((entry) => entry.request.method);
    expect(methods).not.toContain("plugin.setEnabled");
  });
});
