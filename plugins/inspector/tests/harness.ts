// Mounts the inspector on the SDK's test host with a view that records what it was asked to show,
// and a timer the test ticks by hand. The core and the runtime answer from golden/answers.json, the
// same answers the CLI's test reads. The SDK is imported by its workspace path.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineUiPlugin } from "../../../packages/plugin-sdk/src/index";
import { createTestHost, type TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { createInspector } from "../ui/controller.js";
import type { Table } from "../ui/model.js";

export type Handlers = NonNullable<Parameters<typeof createTestHost>[0]["handlers"]>;

const golden = (name: string) => readFileSync(join(import.meta.dirname, "golden", name), "utf8");

/** What the core and the runtime answer, by method (and by section for desk.inspect.open). */
export const ANSWERS = JSON.parse(golden("answers.json"));
/** What `desk inspect` prints and Export JSON gives for every section at once. */
export const EXPORT = golden("export.txt");

export interface RecordingView {
  lists: Array<{ sections: Array<{ id: string; label: string }>; current: string }>;
  tables: Table[];
  statuses: string[];
  exports: string[];
  sections(sections: Array<{ id: string; label: string }>, current: string): void;
  table(table: Table): void;
  status(text: string): void;
  exported(text: string): void;
}

export function recordingView(): RecordingView {
  const view: RecordingView = {
    lists: [],
    tables: [],
    statuses: [],
    exports: [],
    sections: (sections, current) => view.lists.push({ sections, current }),
    table: (table) => view.tables.push(table),
    status: (text) => view.statuses.push(text),
    exported: (text) => view.exports.push(text),
  };
  return view;
}

/** The core's methods as the answers give them. */
export function core(extra: Handlers = {}): Handlers {
  return {
    "cmd.recent": () => ANSWERS["cmd.recent"],
    "perm.list": () => ANSWERS["perm.list"],
    "plugin.list": () => ANSWERS["plugin.list"],
    "plugin.stats": () => ANSWERS["plugin.stats"],
    ...extra,
  };
}

/** The timers the inspector set: each with its period, and a tick that runs it. */
export interface Timers {
  running: Array<{ ms: number; tick(): void }>;
  every(ms: number, tick: () => void): () => void;
}

export function timers(): Timers {
  const all: Timers = {
    running: [],
    every: (ms, tick) => {
      const timer = { ms, tick };
      all.running.push(timer);
      return () => {
        all.running = all.running.filter((t) => t !== timer);
      };
    },
  };
  return all;
}

export interface Mounted {
  host: TestHost;
  view: RecordingView;
  timers: Timers;
  app: ReturnType<typeof createInspector>;
  /** The methods the plugin called, in order (cmd.invoke as `cmd.invoke <id> <section>`). */
  methods(): string[];
  params(method: string): unknown[];
  settle(): Promise<void>;
}

export async function mount(
  handlers: Handlers = core(),
  options: { state?: unknown; refuse?: Parameters<typeof createTestHost>[0]["refuse"] } = {},
): Promise<Mounted> {
  const runtime = ANSWERS["desk.inspect.open"] as Record<string, unknown>;
  const host = createTestHost({
    pluginId: "desk.inspector",
    handlers,
    state: options.state,
    refuse: options.refuse,
    commands: {
      "desk.inspect.open": (args) => runtime[(args as { section: string }).section],
    },
  });
  const view = recordingView();
  const clock = timers();
  let app: ReturnType<typeof createInspector> | undefined;
  await defineUiPlugin(
    {
      async mount(ctx) {
        app = createInspector(ctx, view, { every: clock.every });
        await app.ready;
      },
    },
    host.transport,
  );
  const settle = async () => {
    for (let i = 0; i < 4; i++) await host.settle();
  };
  await settle();
  if (!app) throw new Error("the plugin did not mount");
  return {
    host,
    view,
    timers: clock,
    app,
    methods: () =>
      host.calls.map((call) =>
        call.method === "cmd.invoke"
          ? `cmd.invoke ${call.params.id} ${(call.params.args as { section?: string })?.section}`
          : call.method,
      ),
    params: (method) => host.calls.filter((c) => c.method === method).map((c) => c.params),
    settle,
  };
}
