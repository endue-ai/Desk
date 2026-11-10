// @vitest-environment jsdom
// A window host that keeps the live budget (the window manager, ADR 0151, #83): until it has
// decided, every window keeps its frame; once it has, the runtime decides nothing and carries its
// set out: a window left out is asked for its state and its frame taken away, one let back in gets
// its frame back and its state with its next init.
import type { PluginManifest } from "@endue-ai/bridge";
import { afterEach, describe, expect, it, vi } from "vitest";
import display from "../../../../plugins/display/plugin.json";
import { browserCore } from "../bridge/core";
import { createRuntime, type WindowHost } from "../runtime";

const STATE = "ui.surface.state";
type Message = { type: string; name?: string; call?: number; [field: string]: unknown };

const centre = (id: string): PluginManifest => ({
  id,
  version: "0.1.0",
  kind: "ui",
  entry: "ui/index.html",
  surfaces: [{ id: "main", title: id.toUpperCase(), placement: "center" }],
});

async function flush(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
}

/** A plugin's frame played by the test, as the SDK answers: hello, and its state when asked. */
function play(root: HTMLElement, id: string) {
  const heard: Message[] = [];
  const frame = () => root.querySelector<HTMLIFrameElement>(`[data-surface="${id}"] iframe`);
  const send = (data: Message) =>
    window.dispatchEvent(new MessageEvent("message", { data, source: frame()?.contentWindow }));
  const connect = () => {
    frame()?.contentWindow?.addEventListener("message", (event) => {
      const m = event.data as Message;
      heard.push(m);
      if (m.type === "desk:command" && m.name === STATE)
        send({ type: "desk:reply", call: m.call, ok: true, result: { state: { count: 3 } } });
    });
    send({ type: "desk:hello" });
  };
  return { heard, frame, connect };
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("a live budget kept by the window host", () => {
  it("is carried out: left out, a window sleeps with its state; let back in, it loads with it", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"],
    });
    const root = document.createElement("div");
    const windows = document.createElement("div");
    document.body.replaceChildren(root, windows);
    let live: Set<string> | undefined;
    const listeners = new Set<() => void>();
    const host: WindowHost = {
      adopt: (_spec, section) => windows.append(section),
      release: () => {},
      live: () => live,
      onChange: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const decide = async (ids: string[]) => {
      live = new Set(ids);
      for (const listener of listeners) listener();
      await flush();
    };
    const ids = ["a.one", "b.two"];
    const core = browserCore({ manifests: [display as PluginManifest, ...ids.map(centre)] });
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
    const [a, b] = ids.map((id) => play(windows, id));
    a?.connect();
    b?.connect();
    await flush();
    // Undecided: every window keeps its frame, however long it waits.
    await flush(10 * 60_000);
    expect(runtime.frames.asleep("a.one")).toBe(false);
    expect(runtime.frames.asleep("b.two")).toBe(false);

    await decide(["a.one"]);
    await flush(2_000);
    expect(b?.heard.some((m) => m.type === "desk:command" && m.name === STATE)).toBe(true);
    expect(runtime.frames.asleep("b.two")).toBe(true);
    expect(b?.frame()).toBeNull();
    expect(runtime.frames.asleep("a.one")).toBe(false);

    await decide(["a.one", "b.two"]);
    expect(runtime.frames.asleep("b.two")).toBe(false);
    expect(b?.frame()).not.toBeNull();
    b?.heard.splice(0);
    b?.connect();
    await flush();
    expect(b?.heard.find((m) => m.type === "desk:init")).toMatchObject({
      restored: { count: 3 },
    });
    // Left out again just after loading: it stays for its grace (what waits for it), then goes,
    // with nothing else happening.
    await decide(["a.one"]);
    await flush(2_000);
    expect(runtime.frames.asleep("b.two")).toBe(false);
    await flush(10_000);
    expect(runtime.frames.asleep("b.two")).toBe(true);
  });
});
