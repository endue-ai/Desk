import {
  BridgeClient,
  type BridgeEvent,
  browserStub,
  type PluginInfo,
  type StubHandlers,
} from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { PluginHost } from "./plugins";

/** A ready, enabled UI plugin with one centre surface and the permissions given. */
function plugin(id: string, permissions: Array<{ permission: string }> = []): PluginInfo {
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
      permissions,
      surfaces: [{ id: "main", title: id, placement: "center" }],
    },
  } as PluginInfo;
}

/**
 * A host over fake frames that record what the runtime posted to them once they said hello, as
 * the SDK does when its page has loaded.
 */
async function mount(plugins: PluginInfo[], handlers: StubHandlers = {}) {
  const stub = browserStub({ "plugin.list": () => ({ plugins }), ...handlers });
  const frames = new Map<string, { posted: unknown[]; window: Window }>();
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
        frames.set(spec.id, { posted, window });
      },
      close() {},
      reload() {},
      frame: (id) => frames.get(id)?.window ?? null,
    },
    { url: () => "about:blank" },
  );
  await host.start();
  /** A message from plugin `id`'s frame, as its SDK posts it. */
  const say = (id: string, data: unknown) =>
    receive({ source: frames.get(id)?.window, data } as unknown as MessageEvent);
  for (const [id, frame] of frames) {
    say(id, { type: "desk:hello" });
    frame.posted.length = 0;
  }
  return { stub, host, say, posted: (id: string) => frames.get(id)?.posted ?? [] };
}

const prompt = {
  promptId: "p-1",
  caller: "endue.notes",
  permission: { permission: "fs:read", paths: ["~/Documents/**"] },
  reason: "To open qa.md",
  duration: "session",
};

describe("PluginHost events", () => {
  it("posts an event the core addressed to a plugin to that plugin's frame and no other", async () => {
    const { stub, posted } = await mount([
      plugin("a.one", [{ permission: "perm:manage" }]),
      plugin("b.two"),
    ]);
    const event = { event: "perm.prompt", data: prompt, to: ["b.two"] } as unknown as BridgeEvent;
    stub.emit(event);
    expect(posted("b.two")).toEqual([{ type: "desk:event", event }]);
    expect(posted("a.one")).toEqual([]);
  });

  it("gives an unaddressed perm.prompt to the plugins that manage permissions", async () => {
    const { stub, posted } = await mount([
      plugin("a.one", [{ permission: "perm:manage" }]),
      plugin("b.two"),
    ]);
    const event = { event: "perm.prompt", data: prompt } as unknown as BridgeEvent;
    stub.emit(event);
    expect(posted("a.one")).toEqual([{ type: "desk:event", event }]);
    expect(posted("b.two")).toEqual([]);
  });

  it("a plugin whose window closed and opened again still hears the process it started (#160)", async () => {
    const { stub, host, say, posted } = await mount([plugin("endue.terminal")], {
      "proc.spawn": () => ({ procId: "p-1" }),
    });
    const spawn = { id: 1, method: "proc.spawn", params: { command: "zsh" } };
    say("endue.terminal", { type: "desk:calls", calls: [spawn] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const output = (data: string) =>
      ({
        event: "proc.output",
        data: { procId: "p-1", stream: "pty", data, encoding: "utf8" },
      }) as BridgeEvent;

    // The window's ×: the plugin is put away for the session, and its shell goes on in the core.
    host.unmount("endue.terminal");
    stub.emit(output("while away"));
    await host.launch("endue.terminal");
    say("endue.terminal", { type: "desk:hello" });
    posted("endue.terminal").length = 0;
    stub.emit(output("echo two"));
    expect(posted("endue.terminal")).toEqual([{ type: "desk:event", event: output("echo two") }]);
  });
});

describe("PluginHost hot reload", () => {
  it("mounts a plugin that turns ready on an update, as a dev folder filled while the desk runs", async () => {
    // The folder was empty when the desk started: the core lists it as failed under its folder's id.
    const plugins = [{ ...plugin("local.my-plugin"), status: "failed", manifest: undefined }];
    const { stub, host } = await mount(plugins as PluginInfo[]);
    expect(host.mounted()).toEqual([]);

    plugins[0] = { ...plugin("local.my-plugin"), revision: 2 } as (typeof plugins)[0];
    const data = { plugin: "local.my-plugin", change: "updated", revision: 2 };
    stub.emit({ event: "plugin.changed", data } as BridgeEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.mounted()).toEqual(["local.my-plugin"]);
  });

  it("leaves a plugin that is still failed after an update unmounted", async () => {
    const plugins = [{ ...plugin("local.my-plugin"), status: "failed", manifest: undefined }];
    const { stub, host } = await mount(plugins as PluginInfo[]);
    const data = { plugin: "local.my-plugin", change: "updated", revision: 2 };
    stub.emit({ event: "plugin.changed", data } as BridgeEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.mounted()).toEqual([]);
  });

  it("leaves a plugin put away for the session away when its files change", async () => {
    const { stub, host } = await mount([plugin("local.my-plugin")]);
    host.unmount("local.my-plugin");
    const data = { plugin: "local.my-plugin", change: "updated", revision: 2 };
    stub.emit({ event: "plugin.changed", data } as BridgeEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.mounted()).toEqual([]);
  });
});

describe("PluginHost surface URLs (#36)", () => {
  it("asks for each frame's URL with its surface, on mount and on every reload", async () => {
    const [one, bare] = [plugin("a.one"), plugin("b.two")];
    const board = [{ id: "board", title: "Board", placement: "center" as const }];
    const plugins = [
      { ...one, manifest: { ...one.manifest, surfaces: board } },
      { ...bare, manifest: { ...bare.manifest, surfaces: [] } },
    ];
    const stub = browserStub({ "plugin.list": () => ({ plugins: plugins as PluginInfo[] }) });
    const opened = new Map<string, string | undefined>();
    const reloaded: string[] = [];
    const host = new PluginHost(
      {
        bridge: new BridgeClient(stub),
        win: { addEventListener() {}, removeEventListener() {} } as unknown as Window,
        open: (spec) => opened.set(spec.id, spec.src),
        close() {},
        reload: (_id, src) => reloaded.push(src),
        frame: () => null,
      },
      { url: (id, path, revision, surface) => `${surface}|${id}|${path}|${revision}` },
    );
    await host.start();
    expect(opened.get("a.one")).toBe("board|a.one|ui/index.html|1");
    // A plugin that declares no surface still gets one of its own.
    expect(opened.get("b.two")).toBe("main|b.two|ui/index.html|1");

    const data = { plugin: "a.one", change: "updated", revision: 2 };
    stub.emit({ event: "plugin.changed", data } as BridgeEvent);
    expect(reloaded).toEqual(["board|a.one|ui/index.html|2"]);
  });
});
