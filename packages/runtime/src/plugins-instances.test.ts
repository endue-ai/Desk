import {
  BridgeClient,
  type BridgeEvent,
  browserStub,
  type PluginInfo,
  type StubHandlers,
} from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { PluginHost } from "./plugins";
import type { SurfaceSpec } from "./surfaces";

const IMAGES = "endue.images";

/** A ready, enabled per-file opener. */
function opener(id = IMAGES): PluginInfo {
  return {
    id,
    status: "ready",
    enabled: true,
    builtIn: false,
    revision: 1,
    manifest: {
      id,
      version: "0.1.0",
      kind: "ui",
      entry: "ui/index.html",
      surfaces: [{ id: "main", title: "Images", placement: "center", instances: "per-file" }],
    },
  } as PluginInfo;
}

/** A host over fake frames, each recording what the runtime posted to it after its hello. */
async function mount(handlers: StubHandlers = {}) {
  const callers: Array<string | undefined> = [];
  const stub = browserStub({
    "plugin.list": () => ({ plugins: [opener()] }),
    "fs.watch": (_params, caller) => {
      callers.push(caller);
      return { watchId: `w-${callers.length}` };
    },
    ...handlers,
  });
  const frames = new Map<string, { posted: unknown[]; window: Window; spec: SurfaceSpec }>();
  const closed: string[] = [];
  let receive = (_event: MessageEvent) => {};
  const win = {
    addEventListener: (_type: string, listener: typeof receive) => {
      receive = listener;
    },
    removeEventListener() {},
  } as unknown as Window;
  const host = new PluginHost(
    {
      bridge: new BridgeClient(stub),
      win,
      open: (spec) => {
        const posted: unknown[] = [];
        const window = { postMessage: (m: unknown) => posted.push(m) } as unknown as Window;
        frames.set(spec.id, { posted, window, spec });
      },
      close: (id) => void closed.push(id),
      reload() {},
      frame: (id) => (closed.includes(id) ? null : (frames.get(id)?.window ?? null)),
    },
    { url: (id, path, _revision, surface) => `desk-plugin://${surface}.${id}/${path}` },
  );
  await host.start();
  const say = (id: string, data: unknown) =>
    receive({ source: frames.get(id)?.window, data } as unknown as MessageEvent);
  const hello = (id: string) => {
    say(id, { type: "desk:hello" });
    const init = frames.get(id)?.posted[0];
    for (const frame of frames.values()) frame.posted.length = 0;
    return init;
  };
  hello(IMAGES);
  const posted = (id: string) => frames.get(id)?.posted ?? [];
  return { stub, host, say, hello, posted, frames, closed, callers };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("PluginHost with several windows of one plugin (ADR 0212)", () => {
  it("opens another window on a host of its own and tells its page which window it is", async () => {
    const { host, hello, frames } = await mount();
    const key = host.another(IMAGES);
    expect(key).toBe(`${IMAGES}@2`);
    expect(frames.get(key)?.spec).toMatchObject({
      id: key,
      surface: "main",
      placement: "center",
      src: `desk-plugin://main--2.${IMAGES}/ui/index.html`,
    });
    expect(hello(key)).toEqual({
      type: "desk:init",
      pluginId: IMAGES,
      instance: key,
      state: undefined,
    });
    expect(host.mounted()).toEqual([IMAGES]);
    expect(host.instances(IMAGES)).toEqual([IMAGES, key]);
  });

  it("forwards every window's calls as the plugin, and its watch's changes to that window only", async () => {
    const { stub, host, say, hello, posted, callers } = await mount();
    const second = host.another(IMAGES);
    hello(second);
    const watch = (id: number) => ({ id, method: "fs.watch", params: { path: "~/b.png" } });
    say(second, { type: "desk:calls", calls: [watch(7)] });
    await tick();
    say(IMAGES, { type: "desk:calls", calls: [watch(8)] });
    await tick();
    expect(callers).toEqual([IMAGES, IMAGES]);
    posted(second).length = 0;
    posted(IMAGES).length = 0;

    const changed = (watchId: string) =>
      ({
        event: "fs.changed",
        data: { watchId, path: "~/b.png", change: "modified" },
      }) as BridgeEvent;
    stub.emit(changed("w-1"));
    expect(posted(second)).toEqual([{ type: "desk:event", event: changed("w-1") }]);
    expect(posted(IMAGES)).toEqual([]);
    stub.emit(changed("w-2"));
    expect(posted(IMAGES)).toEqual([{ type: "desk:event", event: changed("w-2") }]);
  });

  it("asks a window by its key, and a plugin id asks its first window", async () => {
    const { host, hello, posted } = await mount();
    const second = host.another(IMAGES);
    hello(second);
    void host.request(second, "desk.files.visit", { buffer: "file:~/b.png" });
    void host.request(IMAGES, "desk.files.visit", { buffer: "file:~/a.png" });
    expect(posted(second)).toMatchObject([
      { type: "desk:command", name: "desk.files.visit", args: { buffer: "file:~/b.png" } },
    ]);
    expect(posted(IMAGES)).toMatchObject([
      { type: "desk:command", name: "desk.files.visit", args: { buffer: "file:~/a.png" } },
    ]);
  });

  it("closes one window and leaves the others; the last one takes the plugin with it", async () => {
    const { host, hello, closed } = await mount();
    const second = host.another(IMAGES);
    hello(second);
    const third = host.another(IMAGES);
    hello(third);
    host.unmount(second);
    expect(closed).toEqual([second]);
    expect(host.instances(IMAGES)).toEqual([IMAGES, third]);
    host.unmount(IMAGES);
    expect(host.mounted()).toEqual([IMAGES]);
    // Launching the plugin shows its window in use; asking it by its id asks that window.
    expect(host.inUse(IMAGES)).toBe(third);
    host.unmount(third);
    expect(closed).toEqual([second, IMAGES, third]);
    expect(host.mounted()).toEqual([]);
  });

  it("answers a command run in the window that ran it", async () => {
    let runs = 0;
    const { stub, host, say, hello, posted } = await mount({
      "cmd.invoke": () => ({ invocationId: `inv-${++runs}` }),
    });
    const second = host.another(IMAGES);
    hello(second);
    const run = { id: 3, method: "cmd.invoke", params: { id: "desk.files.open", args: {} } };
    say(second, { type: "desk:calls", calls: [run] });
    await tick();
    // The first window called the desk since: it is the plugin's window in use now.
    host.focused(IMAGES);
    posted(second).length = 0;
    const answered = {
      event: "cmd.answered",
      data: { invocationId: "inv-1", id: "desk.files.open", caller: IMAGES, ok: true, result: "b" },
    } as BridgeEvent;
    stub.emit(answered);
    expect(posted(second)).toEqual([{ type: "desk:event", event: answered }]);
    expect(posted(IMAGES)).toEqual([]);
  });

  it("keeps each window's state and sleep apart", async () => {
    const { host, say, hello } = await mount();
    const second = host.another(IMAGES);
    hello(second);
    say(second, { type: "desk:state", state: { shown: "b.png" } });
    host.unloaded(second, { view: "b.png" });
    expect(host.asleep(second)).toBe(true);
    expect(host.asleep(IMAGES)).toBe(false);
    expect(hello(second)).toEqual({
      type: "desk:init",
      pluginId: IMAGES,
      instance: second,
      state: { shown: "b.png" },
      restored: { view: "b.png" },
    });
    expect(host.asleep(second)).toBe(false);
  });
});
