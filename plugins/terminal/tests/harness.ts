// Mounts the terminal plugin on the SDK's test host with a view that records what it was asked to
// do. The SDK is imported by its workspace path, as the other plugins' tests do.
import { StubError } from "../../../packages/bridge/src/index";
import { defineUiPlugin } from "../../../packages/plugin-sdk/src/index";
import { createTestHost, type TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { wireCommands } from "../ui/commands.js";
import { createTerminals } from "../ui/sessions.js";
import type { Platform } from "../ui/shell.js";

type Options = Parameters<typeof createTestHost>[0];
export type Handlers = NonNullable<Options["handlers"]>;
export type Commands = NonNullable<Options["commands"]>;

export interface RecordingView {
  opened: Array<{ id: string; title: string }>;
  writes: Array<{ id: string; data: string | Uint8Array }>;
  lines: Array<{ id: string; text: string }>;
  shown: string[];
  closed: string[];
  cleared: string[];
  titles: Array<{ id: string; title: string }>;
  focused: string[];
  statuses: string[];
  size: { cols: number; rows: number };
  open(id: string, title: string): { cols: number; rows: number };
  write(id: string, data: string | Uint8Array): void;
  line(id: string, text: string): void;
  show(id: string): void;
  close(id: string): void;
  clear(id: string): void;
  retitle(id: string, title: string): void;
  focus(id: string): void;
  status(text: string): void;
}

export function recordingView(size = { cols: 80, rows: 24 }): RecordingView {
  const view: RecordingView = {
    opened: [],
    writes: [],
    lines: [],
    shown: [],
    closed: [],
    cleared: [],
    titles: [],
    focused: [],
    statuses: [],
    size,
    open: (id, title) => {
      view.opened.push({ id, title });
      return { ...view.size };
    },
    write: (id, data) => view.writes.push({ id, data }),
    line: (id, text) => view.lines.push({ id, text }),
    show: (id) => view.shown.push(id),
    close: (id) => view.closed.push(id),
    clear: (id) => view.cleared.push(id),
    retitle: (id, title) => view.titles.push({ id, title }),
    focus: (id) => view.focused.push(id),
    status: (text) => view.statuses.push(text),
  };
  return view;
}

export interface Mounted {
  host: TestHost;
  view: RecordingView;
  app: ReturnType<typeof createTerminals>;
  /** The params of every call to one bridge method. */
  params(method: string): unknown[];
  /** The args of every run of one desk command. */
  ran(name: string): unknown[];
  /** Wait until the plugin is quiet: calls answered, follow-ups answered, the snapshot written. */
  settle(): Promise<void>;
}

/** proc.* answered as the core would, numbering processes p1, p2, ... */
export function processes(): Handlers {
  let n = 0;
  return {
    "proc.spawn": () => {
      n += 1;
      return { procId: `p${n}`, pid: 1000 + n };
    },
    "proc.write": () => ({}),
    "proc.resize": () => ({}),
    "proc.kill": () => ({}),
  };
}

/** The desk commands the terminal runs, answered as the desk would. */
export function desk(): Commands {
  let buffers = 0;
  return {
    "desk.buffers.open": () => {
      buffers += 1;
      return `endue.terminal:${buffers}`;
    },
    "desk.buffers.update": () => ({}),
    "desk.buffers.close": () => true,
  };
}

export const denied = (what: string) =>
  new StubError("permission_denied", `${what} is not granted`);
export const missing = (what: string) => new StubError("not_found", `${what}: no such program`);

export async function mount(
  options: {
    handlers?: Handlers;
    commands?: Commands;
    state?: unknown;
    platform?: Platform;
    settings?: Record<string, unknown>;
    size?: { cols: number; rows: number };
  } = {},
): Promise<Mounted> {
  const host = createTestHost({
    pluginId: "endue.terminal",
    state: options.state,
    handlers: {
      ...processes(),
      "init.get": () => ({ profile: "default", settings: options.settings ?? {} }),
      ...options.handlers,
    },
    commands: { ...desk(), ...options.commands },
  });
  const view = recordingView(options.size);
  let app: ReturnType<typeof createTerminals> | undefined;
  await defineUiPlugin(
    {
      mount(ctx) {
        app = createTerminals(ctx, view, { platform: options.platform ?? "mac", snapshotMs: 0 });
        wireCommands(ctx.commands, app);
        return app.start();
      },
    },
    host.transport,
  );
  const settle = async () => {
    for (let i = 0; i < 6; i++) await host.settle();
  };
  await settle();
  if (!app) throw new Error("the plugin did not mount");
  return {
    host,
    view,
    app,
    params: (method) => host.calls.filter((c) => c.method === method).map((c) => c.params),
    ran: (name) => host.ran.filter((r) => r.name === name).map((r) => r.args),
    settle,
  };
}

export const ENV = { TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "endue-desk" };
export const scope = (command: string) =>
  ({ permission: "proc:spawn", commands: [command], pty: true }) as const;
