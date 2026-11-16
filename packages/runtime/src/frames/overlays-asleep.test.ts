// @vitest-environment jsdom
// A hidden overlay sleeps while the desk is out of sight (#312, ADR 0246): its state is asked for
// and its frame taken away when the desk's page goes hidden (the window closed, ADR 0225), and it
// loads again with its state when the page shows. A shown overlay keeps its frame. On the runtime
// itself, as unload.test.ts plays it: the browser stub's core, plugin frames played by the test,
// fake timers and a window host whose live set keeps every window.
import type { PluginManifest } from "@endue-ai/bridge";
import { afterEach, describe, expect, it, vi } from "vitest";
import display from "../../../../plugins/display/plugin.json";
import { browserCore } from "../bridge/core";
import { createRuntime, type WindowHost } from "../runtime";

type Message = { type: string; name?: string; call?: number; [field: string]: unknown };

const overlay = (id: string): PluginManifest => ({
  id,
  version: "0.1.0",
  kind: "ui",
  entry: "ui/index.html",
  surfaces: [{ id: "main", title: id.toUpperCase(), placement: "overlay", hidden: true }],
});
const centre = (id: string): PluginManifest => ({
  id,
  version: "0.1.0",
  kind: "ui",
  entry: "ui/index.html",
  surfaces: [{ id: "main", title: id.toUpperCase(), placement: "center" }],
});

/** One plugin's frame, played by the test: it says hello and hands its state over as the SDK does. */
class Plugin {
  messages: Message[] = [];
  constructor(readonly id: string) {}
  section = () => document.querySelector<HTMLElement>(`[data-surface="${this.id}"]`);
  frame = () => this.section()?.querySelector("iframe") ?? null;
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
    if (message.type !== "desk:command" || message.name !== "ui.surface.state") return;
    this.send({ type: "desk:reply", call: message.call, ok: true, result: { state: { q: "ab" } } });
  }
}

async function flush(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
}

/** The desk's page shown or hidden, as Chromium tells a page whose window closed or came back. */
let hidden = false;
async function pageHidden(value: boolean): Promise<void> {
  hidden = value;
  document.dispatchEvent(new Event("visibilitychange"));
  await flush();
}

async function desk(overlays: string[], windows: string[]) {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"],
  });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  const root = document.createElement("div");
  const held = document.createElement("div");
  document.body.replaceChildren(root, held);
  const host: WindowHost = {
    adopt: (_spec, section) => held.append(section),
    release: () => {},
    live: () => new Set(windows),
    onChange: () => () => {},
  };
  const manifests = [display as PluginManifest, ...overlays.map(overlay), ...windows.map(centre)];
  const core = browserCore({ manifests });
  const runtime = createRuntime({
    root,
    bridge: core.client,
    plugins: { url: (id, path, revision) => `/plugins/${id}/${path}?v=${revision}` },
    windows: host,
  });
  let started = false;
  void runtime.plugins?.ready.then(() => {
    started = true;
  });
  for (let i = 0; i < 50 && !started; i++) await flush(10);
  const plugins = Object.fromEntries(
    [...overlays, ...windows].map((id) => [id, new Plugin(id)]),
  );
  for (const plugin of Object.values(plugins)) plugin.connect();
  await flush();
  const asleep = (id: string) => plugins[id]?.frame() === null;
  return { runtime, plugins, asleep };
}

afterEach(() => {
  vi.useRealTimers();
  hidden = false;
  document.body.replaceChildren();
});

describe("a hidden overlay sleeps while the desk is out of sight", () => {
  it("goes with its state when the page hides, and comes back with it when the page shows", async () => {
    const d = await desk(["a.launcher"], ["b.notes"]);
    const launcher = d.plugins["a.launcher"];
    if (!launcher) throw new Error("no a.launcher");
    expect(d.asleep("a.launcher")).toBe(false);

    await pageHidden(true);
    expect(launcher.messages.some((m) => m.name === "ui.surface.state")).toBe(true);
    expect(d.asleep("a.launcher")).toBe(true);
    // A window is the live budget's (the window manager's set keeps it here).
    expect(d.asleep("b.notes")).toBe(false);

    await pageHidden(false);
    expect(d.asleep("a.launcher")).toBe(false);
    launcher.messages = [];
    launcher.connect();
    await flush();
    expect(launcher.messages.filter((m) => m.type === "desk:init")).toMatchObject([
      { type: "desk:init", pluginId: "a.launcher", restored: { q: "ab" } },
    ]);
  });

  it("keeps a shown overlay, and one with the keys", async () => {
    const d = await desk(["a.palette", "c.permissions"], ["b.notes"]);
    d.plugins["a.palette"]?.send({ type: "desk:visible", visible: true });
    await flush();
    d.runtime.focusSurface("c.permissions");
    await flush();

    await pageHidden(true);
    expect(d.asleep("a.palette")).toBe(false);
    expect(d.asleep("c.permissions")).toBe(false);
  });

  it("a desk in sight keeps every hidden overlay", async () => {
    const d = await desk(["a.launcher"], ["b.notes"]);
    await flush(60_000);
    expect(d.asleep("a.launcher")).toBe(false);
  });
});
