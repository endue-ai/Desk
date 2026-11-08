// Mounts the terminal plugin on the SDK's test host with a view that records what it was asked to
// do. The SDK is imported by its workspace path, as the other plugins' tests do.
import { StubError } from "../../../packages/bridge/src/index";
import { defineUiPlugin } from "../../../packages/plugin-sdk/src/index";
import { createTestHost, type TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { wireCommands } from "../ui/commands.js";
import { createDrops } from "../ui/drops.js";
import { createPasteGuard } from "../ui/paste.js";
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
  /** Visual bells, badges (unread notices per tab), exit banners and tab moves. */
  flashes: string[];
  badges: Array<{ id: string; count: number }>;
  ended: Array<{ id: string; text: string | null }>;
  moved: Array<{ id: string; index: number }>;
  /** What went in through each terminal's paste guard, and the questions it asked. */
  pasted: Array<{ id: string; text: string }>;
  asked: Array<{ id: string; lines: number }>;
  /** Whether the program brackets pastes, and the person's answer to a paste question. */
  bracketed: boolean;
  answer: boolean;
  /** The panes' stand-in as the drop target. */
  dropTarget: object;
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
  flash(id: string): void;
  badge(id: string, count: number): void;
  end(id: string, text: string | null): void;
  move(id: string, index: number): void;
  pasteGuard(id: string): { paste(text: string): Promise<boolean> };
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
    flashes: [],
    badges: [],
    ended: [],
    moved: [],
    pasted: [],
    asked: [],
    bracketed: false,
    answer: true,
    dropTarget: {},
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
    flash: (id) => view.flashes.push(id),
    badge: (id, count) => view.badges.push({ id, count }),
    end: (id, text) => view.ended.push({ id, text }),
    move: (id, index) => view.moved.push({ id, index }),
    pasteGuard: (id) =>
      createPasteGuard({
        paste: (text) => view.pasted.push({ id, text }),
        ask: async (_text, lines) => {
          view.asked.push({ id, lines });
          return view.answer;
        },
        bracketed: () => view.bracketed,
        warn: () => "auto",
      }),
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

/** ui.notify answered as the core would, numbering notifications n1, n2, ... */
export function notifications(): Handlers {
  let n = 0;
  return {
    "ui.notify": () => {
      n += 1;
      return { notificationId: `n${n}` };
    },
  };
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
    /** Whether the person looks at a tab: shown, the page visible and focused. None by default. */
    looking?: (id: string) => boolean;
    /** The clock notices read, in ms. */
    now?: () => number;
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
        app = createTerminals(ctx, view, {
          platform: options.platform ?? "mac",
          snapshotMs: 0,
          ...(options.looking ? { looking: options.looking } : {}),
          ...(options.now ? { now: options.now } : {}),
        });
        wireCommands(ctx.commands, app);
        createDrops(ctx.dnd, app, view);
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
