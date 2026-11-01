// Mounts the docs plugin on the SDK's test host with a view that records what it was asked to show.
// The SDK is imported by its workspace path: plugin folders are not workspace packages yet.
import { StubError } from "../../../packages/bridge/src/index";
import { defineUiPlugin } from "../../../packages/plugin-sdk/src/index";
import { createTestHost, type TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { createDocs, type Shown } from "../ui/docs.js";
import { base64 } from "./model";

type Options = Parameters<typeof createTestHost>[0];
export type Handlers = NonNullable<Options["handlers"]>;
export type Commands = NonNullable<Options["commands"]>;

export interface RecordingView {
  shown: Array<Shown | null>;
  statuses: string[];
  focused: number;
  show(shown: Shown | null): void;
  status(text: string): void;
  focus(): void;
}

export function recordingView(): RecordingView {
  const view: RecordingView = {
    shown: [],
    statuses: [],
    focused: 0,
    show: (shown) => view.shown.push(shown),
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
  params(method: string): unknown[];
  ran(name: string): unknown[];
  settle(): Promise<void>;
}

const DESK: Commands = { "desk.files.changed": () => "reloaded" };

export async function mount(
  options: { handlers?: Handlers; commands?: Commands } = {},
): Promise<Mounted> {
  const host = createTestHost({
    pluginId: "endue.docs",
    handlers: options.handlers ?? {},
    commands: { ...DESK, ...options.commands },
  });
  const view = recordingView();
  let mounted = false;
  await defineUiPlugin(
    {
      mount(ctx) {
        createDocs(ctx, view);
        mounted = true;
      },
    },
    host.transport,
  );
  const settle = async () => {
    for (let i = 0; i < 4; i++) await host.settle();
  };
  await settle();
  if (!mounted) throw new Error("the plugin did not mount");
  return {
    host,
    view,
    params: (method) => host.calls.filter((c) => c.method === method).map((c) => c.params),
    ran: (name) => host.ran.filter((r) => r.name === name).map((r) => r.args),
    settle,
  };
}

/** fs.read (base64) and fs.watch over an in-memory disk; files missing from it are not_found. */
export function disk(files: Record<string, Uint8Array>): Handlers {
  let watches = 0;
  return {
    "fs.read": ({ path }) => {
      const bytes = files[path];
      if (bytes === undefined) throw new StubError("not_found", `no file ${path}`);
      return { content: base64(bytes), encoding: "base64" };
    },
    "fs.watch": () => ({ watchId: `w${++watches}` }),
  };
}

export const denied = (what: string) =>
  new StubError("permission_denied", `${what} is not granted`);

/** A file's buffer and path, as the desk sends them in every request. */
export const file = (path: string) => ({ buffer: `file:${path}`, path });
