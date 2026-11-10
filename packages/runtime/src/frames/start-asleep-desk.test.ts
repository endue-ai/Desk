// @vitest-environment jsdom
// Plugins that start asleep (#590), on the runtime itself: the browser stub's core with a saved
// session in its store, desk.session reading it before the plugins mount, and plugin frames played
// by the test (they say hello and answer a command invocation as the SDK would).
import type { BridgeEvent, PluginManifest } from "@endue-ai/bridge";
import { afterEach, describe, expect, it, vi } from "vitest";
import session from "../../../../plugins/session/plugin.json";
import { browserCore, memoryStore } from "../bridge/core";
import { createRuntime } from "../runtime";

type Message = { type: string; event?: BridgeEvent; [field: string]: unknown };

const ui = (id: string, placement: string, more: Partial<PluginManifest> = {}) =>
  ({
    id,
    version: "0.1.0",
    kind: "ui",
    entry: "ui/index.html",
    surfaces: [{ id: "main", title: id, placement }],
    contributes: { commands: [{ id: `${id}.hello`, title: `${id}: hello` }] },
    ...more,
  }) as PluginManifest;

const MANIFESTS = [
  session as PluginManifest,
  ui("test.asleep", "center"),
  ui("test.shown", "center"),
  ui("test.file", "center"),
  ui("test.edge", "left"),
  ui("test.auto", "center", { autoload: true }),
];

/** What the last start saved: a part shows test.shown, test.file has a file, nothing is in use. */
const SAVED = {
  version: 1,
  files: [{ path: "~/a.txt", plugin: "test.file" }],
  focused: null,
  notices: [],
  parts: { shell: { shows: ["test.shown"] } },
};

async function flush(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
}

async function desk(saved?: unknown) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  const root = document.createElement("div");
  document.body.replaceChildren(root);
  const core = browserCore({
    manifests: MANIFESTS,
    store: memoryStore(saved === undefined ? {} : { session: saved }),
  });
  // The desk turned the autoload plugin on for a file at the last start.
  const auto = core.plugins.find((p) => p.id === "test.auto");
  if (auto) auto.enabled = true;
  const runtime = createRuntime({
    root,
    bridge: core.client,
    plugins: { url: (id, path, revision) => `/plugins/${id}/${path}?v=${revision}` },
  });
  const section = (id: string) => root.querySelector(`[data-surface="${id}"]`);
  const frameElement = (id: string) => section(id)?.querySelector("iframe") ?? null;
  const frame = (id: string) => frameElement(id)?.contentWindow ?? null;
  const send = (id: string, data: Message) =>
    window.dispatchEvent(new MessageEvent("message", { data, source: frame(id) }));
  // The frames that load at start say hello and answer the desk (desk.files.visit, say).
  const connected = new Set<string>();
  const connect = (id: string) => {
    const win = frame(id);
    if (!win || connected.has(id)) return;
    connected.add(id);
    win.addEventListener("message", (event) => {
      const { type, call } = event.data as Message;
      if (type === "desk:command" && typeof call === "number")
        send(id, { type: "desk:reply", call, ok: true, result: {} });
    });
    send(id, { type: "desk:hello" });
  };
  let started = false;
  void runtime.plugins?.ready.then(() => {
    started = true;
  });
  for (let i = 0; i < 50 && !started; i++) {
    await flush(10);
    for (const manifest of MANIFESTS) connect(manifest.id);
  }
  expect(started).toBe(true);
  return { runtime, section, frame, frameElement, send };
}

/** What a browser does when a frame's page focuses one of its elements (jsdom leaves the events out). */
function takeFocus(frame: HTMLIFrameElement | null): void {
  if (!frame) throw new Error("no frame");
  frame.focus();
  frame.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("enabled UI plugins the restored session does not show start asleep (#590)", () => {
  it("with a saved session the desk mounts what it shows, edge bars and autoload plugins, and starts the rest asleep with their commands listed", async () => {
    const d = await desk(SAVED);
    for (const id of ["test.shown", "test.file", "test.edge", "test.auto"])
      expect(d.section(id), id).not.toBeNull();
    expect(d.section("test.asleep")).toBeNull();
    expect(d.runtime.plugins?.mounted()).toContain("test.asleep");
    expect(d.runtime.commands.has("test.asleep.hello")).toBe(true);
    expect(d.runtime.commands.providerOf("test.asleep.hello")).toBe("test.asleep");
  });

  it("a sleeping plugin's command runs: invoking it opens its surface and its answer comes back", async () => {
    const d = await desk(SAVED);
    const answer = d.runtime.commands.run("test.asleep.hello");
    await flush();
    const frame = d.frame("test.asleep");
    expect(frame).not.toBeNull();

    // Its page loads: it listens as the SDK does, says hello, and answers what it is asked.
    const heard: Message[] = [];
    frame?.addEventListener("message", (event) => {
      const message = event.data as Message;
      heard.push(message);
      const invoked = message.event;
      if (message.type !== "desk:event" || invoked?.event !== "cmd.invoked") return;
      const params = { invocationId: invoked.data.invocationId, result: { said: "hello" } };
      d.send("test.asleep", {
        type: "desk:calls",
        calls: [{ id: 1, method: "cmd.answer", params }],
      });
    });
    d.send("test.asleep", { type: "desk:hello" });
    await flush();
    expect(heard.map((m) => m.type)).toContain("desk:init");
    await expect(answer).resolves.toEqual({ said: "hello" });
  });

  it("a window the session puts back that focuses itself as it mounts leaves the focus on the one in use (#76)", async () => {
    const d = await desk({ ...SAVED, focused: "test.shown" });
    const inUse = d.section("test.shown");
    expect(document.activeElement).toBe(inUse);

    // As it mounts it focuses its view, as many plugins do (Docker, late, once its engine answers).
    takeFocus(d.frameElement("test.file"));
    expect(document.activeElement).toBe(inUse);
    expect(d.runtime.shortcuts.focused).toBe("test.shown");

    // A plugin that started asleep and opens on its first use is not one coming back.
    void d.runtime.commands.run("test.asleep.hello").catch(() => {});
    await flush();
    takeFocus(d.frameElement("test.asleep"));
    expect(document.activeElement).toBe(d.frameElement("test.asleep"));
  });

  it("in a window in the background, where no focus event comes, the focus still goes back to the one in use", async () => {
    // No focus event reaches the desk's page: a window in the background (a locked Mac, WKWebView).
    const mute = (event: Event) => event.stopImmediatePropagation();
    window.addEventListener("focusin", mute, true);
    try {
      const d = await desk({ ...SAVED, focused: "test.shown" });
      const inUse = d.section("test.shown");
      expect(document.activeElement).toBe(inUse);
      d.frameElement("test.file")?.focus();
      await flush(300);
      expect(document.activeElement).toBe(inUse);
    } finally {
      window.removeEventListener("focusin", mute, true);
    }
  });

  it("without a saved session every enabled plugin mounts as before", async () => {
    const d = await desk();
    for (const id of ["test.asleep", "test.shown", "test.file", "test.edge", "test.auto"])
      expect(d.section(id), id).not.toBeNull();
  });
});
