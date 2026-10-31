import type { PluginManifest } from "@endue-ai/bridge";
import { describe, expect, it, vi } from "vitest";
import { browserCore, memoryStore } from "../bridge/core";
import { ManualClock } from "../clock";
import { PolicyHub } from "../hub";
import { type BuffersPolicy, installBuffers } from "./buffers";
import type { DeskContext } from "./context";
import { installFiles } from "./files";

const SHEETS = "example.sheets";
const ECHO = "example.echo";
const MANAGE = { permission: "plugin:manage" } as const;

const policy = (id: string): PluginManifest => ({
  id,
  version: "0.1.0",
  kind: "policy",
  contributes: {},
});
/** A UI plugin with a centre surface that opens `pattern`. */
const opener = (id: string, pattern: string, autoload = false): PluginManifest => ({
  id,
  version: "0.1.0",
  kind: "ui",
  entry: "ui/index.html",
  surfaces: [{ id: "main", title: id, placement: "center" }],
  contributes: { files: [{ pattern, plugin: id }] },
  ...(autoload ? { autoload: true } : {}),
});

interface DeskOptions {
  /** Off at start besides the autoload plugin, which starts off as the core starts it. */
  off?: string[];
  /** On at start, as a stored enabled flag would have it. */
  on?: string[];
  store?: Record<string, unknown>;
}

/**
 * desk.buffers and desk.files on the stub core, with a plugin host that mounts a UI plugin when it
 * is turned on (its surface becomes a buffer) and takes it away when it is turned off.
 */
async function desk({ off = [], on = [], store = {} }: DeskOptions = {}) {
  const core = browserCore({
    manifests: [
      policy("desk.buffers"),
      policy("desk.files"),
      opener(SHEETS, "*.csv", true),
      opener(ECHO, "*.txt"),
    ],
    off: [SHEETS, ...off],
    store: memoryStore(store),
  });
  for (const id of on) {
    const info = core.plugins.find((p) => p.id === id);
    if (info) info.enabled = true;
  }
  const bridge = core.client;
  const hub = new PolicyHub(bridge);
  const mounted = new Set<string>();
  const waiting = new Map<string, Array<() => void>>();
  const log: string[] = [];
  let buffers: BuffersPolicy | undefined;
  const list = async () => hub.apply((await bridge.call("plugin.list", { scope: MANAGE })).plugins);
  const mount = (id: string) => {
    if (mounted.has(id)) return;
    mounted.add(id);
    buffers?.surfaceOpened(id, id);
    for (const resolve of waiting.get(id) ?? []) resolve();
    waiting.delete(id);
  };
  const unmount = (id: string) => {
    if (mounted.delete(id)) buffers?.surfaceClosed(id);
  };
  bridge.onEvent((event) => {
    if (event.event !== "plugin.changed") return;
    const { plugin, change } = event.data;
    if (change === "disabled") unmount(plugin);
    void list().then(() => {
      if (change === "enabled") mount(plugin);
    });
  });
  const ctx = {
    hub,
    bridge,
    clock: new ManualClock(),
    surfaces: { show: () => {} },
    share: () => {},
    request: async (plugin: string, command: string, args?: { path?: string; buffer?: string }) => {
      if (!mounted.has(plugin)) throw new Error(`${plugin} is not running`);
      log.push(`${plugin} ${command} ${args?.path ?? args?.buffer ?? ""}`);
      return null;
    },
    mounted: (plugin: string) => mounted.has(plugin),
    whenReady: (plugin: string) =>
      mounted.has(plugin)
        ? Promise.resolve()
        : new Promise<void>((resolve) =>
            waiting.set(plugin, [...(waiting.get(plugin) ?? []), resolve]),
          ),
    unmount,
  } as unknown as DeskContext;
  buffers = installBuffers(ctx, { focus: () => {} });
  const files = installFiles(ctx, buffers, () => {});
  await files.load();
  await list();
  for (const plugin of hub.plugins) if (plugin.enabled) mount(plugin.id);
  await hub.commands.settled();
  const enabled = (id: string) => core.plugins.find((p) => p.id === id)?.enabled;
  const run = (id: string, args?: unknown) => hub.commands.run(id, args);
  const byHand = async (plugin: string, on: boolean) => {
    await bridge.call("plugin.setEnabled", { plugin, enabled: on, scope: MANAGE });
    await vi.waitFor(() => expect(mounted.has(plugin)).toBe(on));
  };
  /** Let every turn-off the desk asked for reach the core and the host. */
  const quiet = async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    await hub.commands.settled();
  };
  return { core, hub, files, buffers, mounted, log, store, enabled, run, byHand, quiet };
}

describe("desk.files turns autoload openers on for a file and off after its last one", () => {
  it("opening a file of an off autoload plugin turns it on and visits", async () => {
    const d = await desk();
    expect(d.enabled(SHEETS)).toBe(false);
    expect(d.mounted.has(SHEETS)).toBe(false);
    expect(await d.run("desk.files.open", { path: "~/a.csv" })).toBe("file:~/a.csv");
    expect(d.enabled(SHEETS)).toBe(true);
    expect(d.mounted.has(SHEETS)).toBe(true);
    expect(d.log).toContain(`${SHEETS} desk.files.visit ~/a.csv`);
  });

  it("closing its last file buffer turns it off, so its window goes", async () => {
    const d = await desk();
    await d.run("desk.files.open", { path: "~/a.csv" });
    expect(await d.run("desk.buffers.close", { id: "file:~/a.csv" })).toBe(true);
    await vi.waitFor(() => expect(d.enabled(SHEETS)).toBe(false));
    expect(d.mounted.has(SHEETS)).toBe(false);
    expect(d.buffers.buffers.ofPlugin(SHEETS)).toEqual([]);
    // It heard the close before it went.
    expect(d.log).toContain(`${SHEETS} desk.buffers.closed file:~/a.csv`);
  });

  it("with two files open, closing one keeps it on", async () => {
    const d = await desk();
    await d.run("desk.files.open", { path: "~/a.csv" });
    await d.run("desk.files.open", { path: "~/b.csv" });
    await d.run("desk.buffers.close", { id: "file:~/a.csv" });
    await d.quiet();
    expect(d.enabled(SHEETS)).toBe(true);
    expect(d.mounted.has(SHEETS)).toBe(true);
    await d.run("desk.buffers.close", { id: "file:~/b.csv" });
    await vi.waitFor(() => expect(d.enabled(SHEETS)).toBe(false));
  });

  it("a plugin the person turned on is never turned off by the desk", async () => {
    const d = await desk();
    await d.byHand(SHEETS, true);
    await d.run("desk.files.open", { path: "~/a.csv" });
    await d.run("desk.buffers.close", { id: "file:~/a.csv" });
    await d.quiet();
    expect(d.enabled(SHEETS)).toBe(true);
    expect(d.mounted.has(SHEETS)).toBe(true);
  });

  it("a non-autoload opener is never turned off", async () => {
    const d = await desk();
    await d.run("desk.files.open", { path: "~/a.txt" });
    await d.run("desk.buffers.close", { id: "file:~/a.txt" });
    await d.quiet();
    expect(d.enabled(ECHO)).toBe(true);
    // Off, its rules do not count; named, desk.files turns it on, and it stays on all the same.
    const off = await desk({ off: [ECHO] });
    await off.run("desk.files.open", { path: "~/b.txt", plugin: ECHO });
    expect(off.enabled(ECHO)).toBe(true);
    await off.run("desk.buffers.close", { id: "file:~/b.txt" });
    await off.quiet();
    expect(off.enabled(ECHO)).toBe(true);
    expect(off.mounted.has(ECHO)).toBe(true);
  });
});

describe("what desk.files remembers about the autoload plugins it turned on", () => {
  it("turned off and on again by hand while it held a file, the plugin is the person's", async () => {
    const d = await desk();
    await d.run("desk.files.open", { path: "~/a.csv" });
    await d.byHand(SHEETS, false);
    await d.byHand(SHEETS, true);
    await d.run("desk.files.open", { path: "~/b.csv" });
    await d.run("desk.buffers.close", { id: "file:~/b.csv" });
    await d.quiet();
    expect(d.enabled(SHEETS)).toBe(true);
  });

  it("after a restart, the plugin goes with its last file all the same", async () => {
    const first = await desk();
    await first.run("desk.files.open", { path: "~/a.csv" });
    await first.quiet();
    // Quit with the file open: its enabled flag stayed on, and desk.session opens it again.
    const next = await desk({ on: [SHEETS], store: first.store });
    expect(next.mounted.has(SHEETS)).toBe(true);
    await next.run("desk.files.open", { path: "~/a.csv" });
    await next.run("desk.buffers.close", { id: "file:~/a.csv" });
    await vi.waitFor(() => expect(next.enabled(SHEETS)).toBe(false));
  });

  it("after a restart that brought no file back, settle turns the plugin off", async () => {
    const first = await desk();
    await first.run("desk.files.open", { path: "~/a.csv" });
    await first.quiet();
    const next = await desk({ on: [SHEETS], store: first.store });
    await next.files.settle();
    await vi.waitFor(() => expect(next.enabled(SHEETS)).toBe(false));
    expect(next.mounted.has(SHEETS)).toBe(false);
  });

  it("settle leaves a plugin the person turned on, and one that holds a file", async () => {
    const d = await desk({ on: [SHEETS] });
    await d.files.settle();
    await d.quiet();
    expect(d.enabled(SHEETS)).toBe(true);
    await d.byHand(SHEETS, false);
    await d.run("desk.files.open", { path: "~/a.csv" });
    await d.files.settle();
    await d.quiet();
    expect(d.enabled(SHEETS)).toBe(true);
  });
});
