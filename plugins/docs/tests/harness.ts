// Mounts the docs plugin on the SDK's test host with a view that records what it was asked to show.
// The SDK is imported by its workspace path: plugin folders are not workspace packages yet.
import { StubError } from "../../../packages/bridge/src/index";
import {
  defineUiPlugin,
  keepFiles,
  readBytes,
  type startWorker,
} from "../../../packages/plugin-sdk/src/index";
import { createTestHost, type TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { createDocs, type Progress, type Shown, type Where } from "../ui/docs.js";
import type { openDocument } from "../ui/open.js";
import { base64 } from "./model";

type Options = Parameters<typeof createTestHost>[0];
export type Handlers = NonNullable<Options["handlers"]>;
export type Commands = NonNullable<Options["commands"]>;

export interface RecordingView {
  shown: Array<Shown | null>;
  statuses: string[];
  /** Every progress the plugin showed, without its Cancel; null when it hid the bar. */
  phases: Array<Omit<Progress, "cancel"> | null>;
  /** Where each show was asked to put the view (undefined: where it was). */
  wheres: Array<Where | undefined>;
  focused: number;
  /** Where the person is in what is shown, as the page view would answer: a test moves it. */
  here: Where;
  /** Press the bar's Cancel, as the person would. */
  cancel(): void;
  show(shown: Shown | null, where?: Where): void;
  where(): Where;
  status(text: string): void;
  focus(): void;
  progress(value: Progress | null): void;
}

export function recordingView(): RecordingView {
  let cancel = () => {};
  const view: RecordingView = {
    shown: [],
    statuses: [],
    phases: [],
    wheres: [],
    focused: 0,
    here: { at: null, zoom: null },
    cancel: () => cancel(),
    show: (shown, where) => {
      view.shown.push(shown);
      view.wheres.push(where);
    },
    where: () => view.here,
    status: (text) => view.statuses.push(text),
    focus: () => {
      view.focused++;
    },
    progress: (value) => {
      if (!value) return void view.phases.push(null);
      const { cancel: press, ...rest } = value;
      cancel = press;
      view.phases.push(rest);
    },
  };
  return view;
}

export interface Mounted {
  host: TestHost;
  view: RecordingView;
  app: ReturnType<typeof createDocs>;
  params(method: string): unknown[];
  ran(name: string): unknown[];
  settle(): Promise<void>;
}

const DESK: Commands = { "desk.files.changed": () => "reloaded" };

export async function mount(
  options: {
    handlers?: Handlers;
    commands?: Commands;
    prompt?: Options["prompt"];
    startWorker?: typeof startWorker;
    open?: typeof openDocument;
    /** What the last sleep kept (ctx.surface.restored). */
    restored?: unknown;
    /** False: resolve once mounted, without waiting for its calls (a test holds one back). */
    settled?: boolean;
  } = {},
): Promise<Mounted> {
  const host = createTestHost({
    pluginId: "endue.docs",
    handlers: options.handlers ?? {},
    commands: { ...DESK, ...options.commands },
    prompt: options.prompt,
    ...(options.restored === undefined ? {} : { restored: options.restored }),
  });
  const view = recordingView();
  let app: ReturnType<typeof createDocs> | undefined;
  await defineUiPlugin(
    {
      mount(ctx) {
        app = createDocs(ctx, view, {
          read: readBytes,
          startWorker: options.startWorker,
          open: options.open,
          keepFiles,
        });
      },
    },
    host.transport,
  );
  const settle = async () => {
    for (let i = 0; i < 4; i++) await host.settle();
  };
  if (options.settled !== false) await settle();
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

/**
 * fs.read (base64, in ranges, with the size) and fs.watch over an in-memory disk; files missing
 * from it are not_found. Without fs.url the SDK's readBytes reads through fs.read.
 */
export function disk(files: Record<string, Uint8Array>): Handlers {
  let watches = 0;
  return {
    "fs.read": ({ path, offset = 0, length }) => {
      const bytes = files[path];
      if (bytes === undefined) throw new StubError("not_found", `no file ${path}`);
      const end = length === undefined ? bytes.length : offset + length;
      return {
        content: base64(bytes.subarray(offset, end)),
        encoding: "base64",
        size: bytes.length,
      };
    },
    "fs.watch": () => ({ watchId: `w${++watches}` }),
  };
}

export const denied = (what: string) =>
  new StubError("permission_denied", `${what} is not granted`);

/** A file's buffer and path, as the desk sends them in every request. */
export const file = (path: string) => ({ buffer: `file:${path}`, path });
