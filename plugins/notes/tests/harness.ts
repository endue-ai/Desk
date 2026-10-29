// Mounts the notes plugin on the SDK's test host with a view that records what it was asked to show.
// The SDK is imported by its workspace path: plugin folders are not workspace packages yet.
import { StubError } from "../../../packages/bridge/src/index";
import { defineUiPlugin } from "../../../packages/plugin-sdk/src/index";
import { createTestHost, type TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { createNotes, type NoteModel } from "../ui/notes.js";

type Options = Parameters<typeof createTestHost>[0];
export type Handlers = NonNullable<Options["handlers"]>;
export type Commands = NonNullable<Options["commands"]>;

export interface RecordingView {
  notes: Array<NoteModel | null>;
  statuses: string[];
  /** How many times the plugin moved the keyboard focus to its text area. */
  focused: number;
  note(model: NoteModel | null): void;
  status(text: string): void;
  focus(): void;
}

export function recordingView(): RecordingView {
  const view: RecordingView = {
    notes: [],
    statuses: [],
    focused: 0,
    note: (model) => view.notes.push(model),
    status: (text) => view.statuses.push(text),
    focus: () => {
      view.focused++;
    },
  };
  return view;
}

export interface Mounted {
  host: TestHost;
  view: RecordingView;
  app: ReturnType<typeof createNotes>;
  /** The params of every call to one bridge method. */
  params(method: string): unknown[];
  /** The args of every run of one desk command. */
  ran(name: string): unknown[];
  /** Wait until the plugin is quiet: calls answered and follow-up calls answered too. */
  settle(): Promise<void>;
}

/** The desk commands notes runs, answered as the desk would. */
const DESK: Commands = {
  "desk.files.changed": () => "reloaded",
  "desk.buffers.update": () => ({}),
};

export async function mount(
  options: { handlers?: Handlers; commands?: Commands } = {},
): Promise<Mounted> {
  const host = createTestHost({
    pluginId: "endue.notes",
    handlers: options.handlers ?? {},
    commands: { ...DESK, ...options.commands },
  });
  const view = recordingView();
  let app: ReturnType<typeof createNotes> | undefined;
  await defineUiPlugin(
    {
      mount(ctx) {
        app = createNotes(ctx, view);
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
    app,
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

/** A note's buffer and path, as the desk sends them in every request. */
export const note = (path: string) => ({ buffer: `file:${path}`, path });

export const NOTES_READ = { permission: "fs:read", paths: ["~/Notes/**"] } as const;
export const NOTES_WRITE = { permission: "fs:write", paths: ["~/Notes/**"] } as const;
