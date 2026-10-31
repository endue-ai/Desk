// Mounts the archives plugin on the SDK's test host, with a view that records what it was asked to
// show (or the real DOM view, for the view tests). The SDK is imported by its workspace path.
import { StubError } from "../../../packages/bridge/src/index";
import { defineUiPlugin } from "../../../packages/plugin-sdk/src/index";
import { createTestHost, type TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { type ArchiveModel, createArchives, type PreviewModel, type View } from "../ui/archives.js";

type Options = Parameters<typeof createTestHost>[0];
export type Handlers = NonNullable<Options["handlers"]>;
export type Commands = NonNullable<Options["commands"]>;
export type App = ReturnType<typeof createArchives>;

export interface RecordingView extends View {
  archives: Array<ArchiveModel | null>;
  previews: Array<PreviewModel | null>;
  statuses: string[];
  progresses: string[];
  /** How many times the plugin moved the keyboard focus to its tree. */
  focused: number;
}

export function recordingView(): RecordingView {
  const view: RecordingView = {
    archives: [],
    previews: [],
    statuses: [],
    progresses: [],
    focused: 0,
    archive: (model) => view.archives.push(model),
    preview: (model) => view.previews.push(model),
    status: (text) => view.statuses.push(text),
    progress: (text) => view.progresses.push(text),
    focus: () => {
      view.focused++;
    },
  };
  return view;
}

export interface Mounted<V extends View> {
  host: TestHost;
  view: V;
  app: App;
  params(method: string): unknown[];
  ran(name: string): unknown[];
  settle(): Promise<void>;
}

/** The desk commands the plugin runs, answered as the desk would. */
const DESK: Commands = {
  "desk.files.changed": () => "reloaded",
};

export interface MountOptions<V extends View> {
  files?: Options["files"];
  grants?: Options["grants"];
  prompt?: Options["prompt"];
  handlers?: Handlers;
  commands?: Commands;
  /** The view to mount with; a recording view by default. */
  view?: (app: () => App | undefined) => V;
}

export async function mount<V extends View = RecordingView>(
  options: MountOptions<V> = {},
): Promise<Mounted<V>> {
  const host = createTestHost({
    pluginId: "endue.archives",
    files: options.files,
    grants: options.grants,
    prompt: options.prompt,
    handlers: { "fs.watch": () => ({ watchId: "w1" }), ...options.handlers },
    commands: { ...DESK, ...options.commands },
  });
  let app: App | undefined;
  const view = options.view ? options.view(() => app) : (recordingView() as unknown as V);
  await defineUiPlugin(
    {
      mount(ctx) {
        app = createArchives(ctx, view);
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

export const denied = (what: string) =>
  new StubError("permission_denied", `${what} is not granted`);

/** A file's buffer and path, as the desk sends them in every request. */
export const file = (path: string) => ({ buffer: `file:${path}`, path });

export const READ = (folder: string) =>
  ({ permission: "fs:read", paths: [`${folder}/**`] }) as const;
export const WRITE = (folder: string) =>
  ({ permission: "fs:write", paths: [`${folder}/**`] }) as const;

/** The names of the rows the view was last asked to show, in order. */
export const rowNames = (view: RecordingView) => view.archives.at(-1)?.rows.map((r) => r.name);
