import { BridgeClient, browserStub, type PluginInfo } from "@endue-ai/bridge";
import { beforeEach, describe, expect, it } from "vitest";
import { PluginHost } from "./plugins";
import { PHASE_PREFIX, phase, phases, timed } from "./timing";

const measures = () =>
  performance.getEntriesByType("measure").map((m) => ({
    name: m.name,
    start: m.startTime,
    duration: m.duration,
  }));

beforeEach(() => performance.clearMeasures());

describe("start-up phases as User Timing measures", () => {
  it("phase records a desk: measure from its start to its end", () => {
    phase("session restore", 10, 25);
    expect(PHASE_PREFIX).toBe("desk:");
    expect(measures()).toEqual([{ name: "desk:session restore", start: 10, duration: 15 }]);
  });

  it("timed measures a promise whether it resolves or rejects", async () => {
    await expect(timed("plugin list", async () => 5)).resolves.toBe(5);
    await expect(
      timed("agent directory", () => Promise.reject(new Error("offline"))),
    ).rejects.toThrow("offline");
    expect(measures().map((m) => m.name)).toEqual(["desk:plugin list", "desk:agent directory"]);
    for (const m of measures()) expect(m.duration).toBeGreaterThanOrEqual(0);
  });

  it("phases returns only the desk's measures, named without the prefix", () => {
    performance.measure("someone else's", { start: 1, end: 2 });
    phase("bridge connect", 3, 7.5);
    expect(phases()).toEqual([{ name: "bridge connect", start: 3, duration: 4.5 }]);
  });
});

describe("PluginHost", () => {
  it("measures each plugin's mount from its surface to its hello", async () => {
    const info = {
      id: "a.one",
      status: "ready",
      enabled: true,
      builtIn: true,
      revision: 1,
      manifest: {
        id: "a.one",
        version: "0.1.0",
        kind: "ui",
        entry: "ui/index.html",
        surfaces: [{ id: "main", title: "One", placement: "center" }],
      },
    } as PluginInfo;
    let onMessage: ((event: MessageEvent) => void) | undefined;
    const win = {
      addEventListener: (type: string, listener: (event: MessageEvent) => void) => {
        if (type === "message") onMessage = listener;
      },
      removeEventListener() {},
    } as unknown as Window;
    const frame = { postMessage() {} } as unknown as Window;
    const host = new PluginHost(
      {
        bridge: new BridgeClient(browserStub({ "plugin.list": () => ({ plugins: [info] }) })),
        win,
        open() {},
        close() {},
        reload() {},
        frame: (id) => (id === "a.one" ? frame : null),
      },
      { url: () => "about:blank" },
    );
    await host.start();
    expect(phases().filter((p) => p.name.startsWith("mount "))).toEqual([]);

    onMessage?.({ source: frame, data: { type: "desk:hello" } } as MessageEvent);
    const mounts = phases().filter((p) => p.name.startsWith("mount "));
    expect(mounts.map((p) => p.name)).toEqual(["mount a.one"]);
    expect(mounts[0]?.duration).toBeGreaterThanOrEqual(0);
    expect(phases().map((p) => p.name)).toContain("plugin list");

    // A second hello (a reload) is not a second mount.
    onMessage?.({ source: frame, data: { type: "desk:hello" } } as MessageEvent);
    expect(phases().filter((p) => p.name.startsWith("mount "))).toHaveLength(1);
  });
});
