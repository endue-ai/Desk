// Native plugins (#59, ADR 0154): a native plugin's window is a window like a UI plugin's, on a desk
// whose compositor draws it from the plugin's own process; a desk without one leaves it out.
import { BridgeClient, type BridgeEvent, browserStub, type PluginInfo } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { PluginHost } from "./plugins";
import type { SurfaceSpec } from "./surfaces";

const NATIVE = {
  id: "example.native-wgpu",
  status: "ready",
  enabled: true,
  builtIn: false,
  revision: 3,
  manifest: {
    id: "example.native-wgpu",
    name: "Native wgpu",
    version: "0.1.0",
    kind: "native",
    native: { binaries: { "macos-aarch64": "bin/macos-aarch64/plugin-native-wgpu" } },
    surfaces: [{ id: "main", title: "Native wgpu", placement: "center" }],
  },
} as PluginInfo;

async function opened(native: boolean | undefined) {
  const stub = browserStub({ "plugin.list": () => ({ plugins: [NATIVE] }) });
  const specs: SurfaceSpec[] = [];
  const reloads: string[] = [];
  const host = new PluginHost(
    {
      bridge: new BridgeClient(stub),
      win: { addEventListener() {}, removeEventListener() {} } as unknown as Window,
      open: (spec) => specs.push(spec),
      close() {},
      reload: (_id, src) => reloads.push(src),
      frame: () => null,
    },
    {
      url: (id, path, revision, surface) => `${surface}|${id}|${path}|${revision}`,
      ...(native === undefined ? {} : { native }),
    },
  );
  await host.start();
  return { host, specs, stub, reloads };
}

describe("PluginHost native plugins (#59)", () => {
  it("mounts a native plugin's first surface where the compositor hosts native plugins", async () => {
    const { host, specs } = await opened(true);
    expect(host.mounted()).toEqual(["example.native-wgpu"]);
    // No entry: the frame is the surface's stand-in, on the surface's own host, at its revision.
    expect(specs).toEqual([
      expect.objectContaining({
        id: "example.native-wgpu",
        title: "Native wgpu",
        surface: "main",
        src: "main|example.native-wgpu||3",
      }),
    ]);
  });

  it("loads a native plugin's frame again when its files change, so the desk starts the new program", async () => {
    const { stub, reloads } = await opened(true);
    const data = { plugin: "example.native-wgpu", change: "updated", revision: 4 };
    stub.emit({ event: "plugin.changed", data } as BridgeEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reloads).toEqual(["main|example.native-wgpu||4"]);
  });

  it("leaves native plugins out of a desk that cannot draw them", async () => {
    for (const native of [false, undefined]) {
      const { host, specs } = await opened(native);
      expect(host.mounted()).toEqual([]);
      expect(specs).toEqual([]);
      await expect(host.launch("example.native-wgpu")).rejects.toThrow(/No launchable plugin/);
    }
  });
});
