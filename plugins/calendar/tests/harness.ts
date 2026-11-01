// Mounts the calendar plugin on the SDK's test host with a view that records what it was asked to show,
// a fixed clock, and a timer the test fires by hand. The SDK is imported by its workspace path: plugin
// folders are not workspace packages yet.
import { StubError } from "../../../packages/bridge/src/index";
import { defineUiPlugin } from "../../../packages/plugin-sdk/src/index";
import { createTestHost, type TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { type CalendarState, createCalendar, type EditorState } from "../ui/calendar.js";

type Options = Parameters<typeof createTestHost>[0];
export type Handlers = NonNullable<Options["handlers"]>;
export type Commands = NonNullable<Options["commands"]>;

export interface RecordingView {
  states: CalendarState[];
  editors: Array<EditorState | null>;
  statuses: string[];
  focused: number;
  render(state: CalendarState): void;
  editor(state: EditorState | null): void;
  status(text: string): void;
  focus(): void;
  /** The last state drawn. */
  readonly last: CalendarState;
}

export function recordingView(): RecordingView {
  const view: RecordingView = {
    states: [],
    editors: [],
    statuses: [],
    focused: 0,
    render: (state) => view.states.push(state),
    editor: (state) => view.editors.push(state),
    status: (text) => view.statuses.push(text),
    focus: () => {
      view.focused++;
    },
    get last() {
      const state = view.states.at(-1);
      if (!state) throw new Error("nothing drawn yet");
      return state;
    },
  };
  return view;
}

/** 2026-10-30T09:00:00+09:00, the desk's fixed "today" in the stub fixtures. */
export const NOW = Date.parse("2026-10-30T00:00:00Z");

export interface Mounted {
  host: TestHost;
  view: RecordingView;
  app: ReturnType<typeof createCalendar>;
  clock: { now: number };
  /** Fire the pending timer, as if its time had come. */
  tick(): void;
  params(method: string): unknown[];
  ran(name: string): unknown[];
  settle(): Promise<void>;
}

/** The desk commands the plugin runs, answered as the desk would. */
const DESK: Commands = {
  "desk.files.changed": () => "reloaded",
  "desk.buffers.update": () => ({}),
};

export async function mount(
  options: {
    handlers?: Handlers;
    commands?: Commands;
    settings?: Record<string, unknown>;
    state?: unknown;
  } = {},
): Promise<Mounted> {
  const settings = options.settings ?? { "endue.calendar.time-zone": "Asia/Seoul" };
  const host = createTestHost({
    pluginId: "endue.calendar",
    ...(options.state ? { state: options.state } : {}),
    handlers: {
      "init.get": () => ({ profile: "default", settings }),
      "ui.notify": () => ({ notificationId: "n1" }),
      ...options.handlers,
    },
    commands: { ...DESK, ...options.commands },
  });
  const view = recordingView();
  const clock = { now: NOW };
  let pending: (() => void) | undefined;
  let app: ReturnType<typeof createCalendar> | undefined;
  let ids = 0;
  await defineUiPlugin(
    {
      mount(ctx) {
        app = createCalendar(ctx, view, {
          now: () => clock.now,
          uid: () => `uid-${++ids}@endue.ai`,
          locale: "en-US",
          setTimer: (run) => {
            pending = run;
            return run;
          },
          clearTimer: () => {
            pending = undefined;
          },
        });
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
    clock,
    tick: () => {
      const run = pending;
      pending = undefined;
      run?.();
    },
    params: (method) => host.calls.filter((c) => c.method === method).map((c) => c.params),
    ran: (name) => host.ran.filter((r) => r.name === name).map((r) => r.args),
    settle,
  };
}

/** fs.read, fs.write and fs.watch over an in-memory disk; files missing from it are not_found. */
export function disk(files: Record<string, string>): Handlers {
  let watches = 0;
  return {
    "fs.read": ({ path }) => {
      const content = files[path];
      if (content === undefined) throw new StubError("not_found", `no file ${path}`);
      return { content, encoding: "utf8" };
    },
    "fs.write": ({ path, content }) => {
      files[path] = content;
      return { bytesWritten: content.length };
    },
    "fs.watch": () => ({ watchId: `w${++watches}` }),
  };
}

export const denied = (what: string) =>
  new StubError("permission_denied", `${what} is not granted`);

/** A calendar file's buffer and path, as the desk sends them in every request. */
export const file = (path: string) => ({ buffer: `file:${path}`, path });

export const READ = { permission: "fs:read", paths: ["~/Calendar/**"] } as const;
export const WRITE = { permission: "fs:write", paths: ["~/Calendar/**"] } as const;
