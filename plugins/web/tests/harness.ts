// Mounts the web plugin on the SDK's test host, with a view that records what it was asked to show,
// or with the real view on the test's document. The SDK is imported by its workspace path: plugin
// folders are not workspace packages yet.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StubError } from "../../../packages/bridge/src/index";
import { defineUiPlugin, readBytes } from "../../../packages/plugin-sdk/src/index";
import { createTestHost, type TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import type { Shown } from "../ui/web.js";
import { createWeb } from "../ui/web.js";

type Options = Parameters<typeof createTestHost>[0];
export type Handlers = NonNullable<Options["handlers"]>;
export type Commands = NonNullable<Options["commands"]>;

/** What the plugin shows on the progress bar, or null when it hides it. */
export type Progress = {
  label: string;
  value: number | null;
  max: number;
  detail: string;
  cancel(): void;
} | null;

export interface RecordingView {
  shown: Array<Shown | null>;
  statuses: string[];
  progresses: Progress[];
  /** How many times the plugin moved the keyboard focus to its surface. */
  focused: number;
  show(file: Shown | null): void;
  status(text: string): void;
  progress(value: Progress): void;
  focus(): void;
}

export function recordingView(): RecordingView {
  const view: RecordingView = {
    shown: [],
    statuses: [],
    progresses: [],
    focused: 0,
    show: (file) => {
      view.shown.push(file);
    },
    status: (text) => view.statuses.push(text),
    progress: (value) => view.progresses.push(value),
    focus: () => {
      view.focused++;
    },
  };
  return view;
}

type View = Parameters<typeof createWeb>[1];

/** What the view asks of the plugin: open a local file or a link, or say something. */
export interface Actions {
  open(path: string): unknown;
  external(url: string): unknown;
  say(text: string): void;
}

export interface Mounted<V> {
  host: TestHost;
  view: V;
  /** The params of every call to one bridge method. */
  params(method: string): unknown[];
  /** The args of every run of one desk command. */
  ran(name: string): unknown[];
  /** Wait until the plugin is quiet: calls answered and follow-up calls answered too. */
  settle(): Promise<void>;
}

/** The desk commands web runs, answered as the desk would. */
const DESK: Commands = {
  "desk.files.changed": () => "reloaded",
  "desk.files.open": (args) => `file:${(args as { path: string }).path}`,
};

export async function mount<V extends View = RecordingView>(
  options: {
    handlers?: Handlers;
    commands?: Commands;
    /** Make the view from the plugin's actions; a recording view by default. */
    view?: (actions: Actions) => V;
    /** The rest of createWeb's options: startWorker, the worker threshold. */
    options?: Partial<Parameters<typeof createWeb>[2]>;
  } = {},
): Promise<Mounted<V>> {
  const host = createTestHost({
    pluginId: "endue.web",
    handlers: options.handlers ?? {},
    commands: { ...DESK, ...options.commands },
  });
  let app: ReturnType<typeof createWeb> | undefined;
  const actions: Actions = {
    open: (path: string) => app?.open(path),
    external: (url: string) => app?.external(url),
    say: (text: string) => app?.say(text),
  };
  const view = (options.view ? options.view(actions) : recordingView()) as V;
  await defineUiPlugin(
    {
      mount(ctx) {
        app = createWeb(ctx, view, { read: readBytes, ...options.options });
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
    params: (method) => host.calls.filter((c) => c.method === method).map((c) => c.params),
    ran: (name) => host.ran.filter((r) => r.name === name).map((r) => r.args),
    settle,
  };
}

const base64 = (bytes: Uint8Array | string) =>
  Buffer.from(typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes).toString("base64");

/** The bytes of a file on the in-memory disk. */
const bytesOf = (content: Uint8Array | string) =>
  typeof content === "string" ? new Uint8Array(Buffer.from(content, "utf8")) : content;

/**
 * fs.read (base64, in ranges with the file's size, as readBytes asks when the desk gives no URL)
 * and fs.watch over an in-memory disk; files missing from it are not_found.
 */
export function disk(files: Record<string, Uint8Array | string>): Handlers {
  let watches = 0;
  return {
    "fs.read": ({ path, offset = 0, length }) => {
      const content = files[path];
      if (content === undefined) throw new StubError("not_found", `no file ${path}`);
      const bytes = bytesOf(content);
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

/** The fs.read calls readBytes makes for a whole file of `size` bytes without a URL. */
export const ranged = (path: string, scope: unknown, size: number) => [
  { path, encoding: "base64", offset: 0, length: 0, scope },
  ...(size ? [{ path, encoding: "base64", offset: 0, length: size, scope }] : []),
];

/** A file's buffer and path, as the desk sends them in every request. */
export const file = (path: string) => ({ buffer: `file:${path}`, path });

/** The read grant for one folder, as the plugin asks for it and passes it. */
export const folder = (path: string) => ({ permission: "fs:read", paths: [`${path}/**`] }) as const;

/** The plugin's own page, ui/index.html, put into the test's document. */
export function loadPage(doc: Document) {
  const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
  const page = new DOMParser().parseFromString(html, "text/html");
  for (const script of page.querySelectorAll("script")) script.remove();
  doc.body.replaceChildren(...[...page.body.children].map((node) => doc.importNode(node, true)));
}

/** A fixture made by tests/fixtures/make.sh. */
export const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", name)));
