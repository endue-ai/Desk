import { BridgeClient, type BridgeEvent, browserStub, type PluginInfo } from "@endue-ai/bridge";
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

/** A host over fake frames that record what the runtime posted to them. */
async function mount(plugins: PluginInfo[]) {
  const stub = browserStub({ "plugin.list": () => ({ plugins }) });
  const frames = new Map<string, unknown[]>();
  const win = { addEventListener() {}, removeEventListener() {} } as unknown as Window;
  const host = new PluginHost(
    {
      bridge: new BridgeClient(stub),
      win,
      open: (spec) => frames.set(spec.id, []),
      close() {},
      reload() {},
      frame: (id) => {
        const posted = frames.get(id);
        return posted ? ({ postMessage: (m: unknown) => posted.push(m) } as unknown as Window) : null;
      },
    },
    { url: () => "about:blank" },
  );
  await host.start();
  return { stub, posted: (id: string) => frames.get(id) ?? [] };
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
});
