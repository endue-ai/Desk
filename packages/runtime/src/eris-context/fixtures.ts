/**
 * A shell context for the tests of what Eris knows (ADR 0124): the sample desk with an empty drawer
 * and desk-wm under it (#83), a clock the test moves, a plugin host that hands a plugin's surface
 * over when desk.plugins.open runs and takes it back when its window closes, and the commands the
 * module defines.
 */
import type { CommandInfo, CommandSpec } from "../commands";
import type { ShellCtx } from "../shell/context";
import { Store, sampleState } from "../shell/state";
import { testWindowManager } from "../wm/testing";
import { takeDesk } from "../wm/view";

export const EPOCH = Date.parse("2026-11-08T09:00:00.000Z");

/** Storage that keeps values in memory, as the shell bridge's storage would. */
export function memoryStorage() {
  const saved = new Map<string, unknown>();
  return {
    saved,
    async get<T>(key: string) {
      return structuredClone(saved.get(key)) as T | undefined;
    },
    async set(key: string, value: unknown) {
      saved.set(key, structuredClone(value));
    },
  };
}

export interface FakeOptions {
  storage?: ReturnType<typeof memoryStorage>;
  /** The registry as the core lists it. */
  commands?: CommandInfo[];
  /** Plugins that are on, with the commands their manifests contribute. */
  policy?: { plugins: string[]; commands: Array<{ id: string; title: string; owner: string }> };
  bindings?: Array<{ combo: string; command: string; owner: string; keys: string[] }>;
}

export function fakeDesk(options: FakeOptions = {}) {
  const store = new Store({ ...sampleState("en", EPOCH), drawer: [] });
  const wm = testWindowManager();
  wm.connect((published) => takeDesk(store, published));
  let clock = 1000;
  const specs = new Map<string, CommandSpec>();
  const ran: Array<{ id: string; args: unknown }> = [];
  // desk-wm applies an edit at once: the surface is handed over when this returns.
  const adopt = (id: string) => void wm.edit([{ op: "adopt", id, title: id }]);
  const runtime = {
    ready: Promise.resolve(),
    shortcuts: { focused: null },
    focusSurface() {},
    notify() {},
    plugins: {
      ready: Promise.resolve(),
      mounted: () => store.get().adopted.map((a) => a.id),
      unmount: (id: string) => void wm.edit([{ op: "release", id }]),
    },
    commands: {
      define(id: string, spec: CommandSpec) {
        specs.set(id, spec);
        return () => specs.delete(id);
      },
      async run(id: string, args?: unknown) {
        ran.push({ id, args });
        const plugin = (args as { plugin?: unknown } | undefined)?.plugin;
        if (id === "desk.plugins.open" && typeof plugin === "string") {
          if (plugin === "endue.gone") throw new Error(`No launchable plugin ${plugin}`);
          adopt(plugin);
        }
      },
      list: () => options.commands ?? [],
      has: (id: string) => (options.commands ?? []).some((c) => c.id === id),
    },
    keymap: {
      bindings: () => options.bindings ?? [],
      keysFor: (command: string) =>
        (options.bindings ?? []).filter((b) => b.command === command).flatMap((b) => b.keys),
    },
    policy: () => options.policy ?? { plugins: [], commands: [] },
  };
  const ctx = {
    store,
    wm,
    runtime,
    bridge: { storage: options.storage ?? memoryStorage() },
    now: () => clock,
    wall: () => EPOCH + clock,
    tr: (key: string) => key,
    keyOf: () => undefined,
  } as unknown as ShellCtx;
  return {
    ctx,
    store,
    wm,
    specs,
    ran,
    adopt,
    /** Move the clock on by `ms`. */
    tick(ms: number) {
      clock += ms;
    },
    /** Run a command the module defined, as `caller` (the person when absent). */
    run(id: string, args: unknown = {}, caller?: string) {
      const spec = specs.get(id);
      if (!spec) throw new Error(`${id} is not defined`);
      return spec.run(args, caller ? { caller } : {});
    },
  };
}

/** Let promises that are already settled run their callbacks. */
export const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
