// Mounts the sheets plugin on the SDK's test host with a view that records what it was asked to show.
// The SDK is imported by its workspace path: plugin folders are not workspace packages yet.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StubError } from "../../../packages/bridge/src/index";
import { defineUiPlugin, keepFiles, readBytes } from "../../../packages/plugin-sdk/src/index";
import { createTestHost, type TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { openBook } from "../ui/book.js";
import type { Where } from "../ui/keep.js";
import { createSheets, type Open, type Sheets, type Shown } from "../ui/sheets.js";

type Options = Parameters<typeof createTestHost>[0];
export type Handlers = NonNullable<Options["handlers"]>;
export type Commands = NonNullable<Options["commands"]>;

export interface RecordingView {
  shown: Array<Shown | null>;
  statuses: string[];
  /** How many times the plugin moved the keyboard focus to its grid. */
  focused: number;
  /** Where the person is in each file, as the page's view would say it (view.js where). */
  places: Map<string, Where>;
  /** What the plugin gave back to the view as a file came back from a sleep. */
  restored: Array<[string, Partial<Where>]>;
  show(model: Shown | null): void;
  status(text: string): void;
  focus(): void;
  where(buffer: string): Where | undefined;
  restore(buffer: string, where: Partial<Where>): void;
}

export function recordingView(): RecordingView {
  const view: RecordingView = {
    shown: [],
    statuses: [],
    focused: 0,
    places: new Map(),
    restored: [],
    show: (model) => view.shown.push(model),
    status: (text) => view.statuses.push(text),
    focus: () => {
      view.focused++;
    },
    where: (buffer) => view.places.get(buffer),
    restore: (buffer, where) => {
      view.restored.push([buffer, where]);
    },
  };
  return view;
}

export interface Mounted {
  host: TestHost;
  view: RecordingView;
  /** What the view calls: edits to the file on screen. */
  app: Sheets;
  /** The params of every call to one bridge method. */
  params(method: string): unknown[];
  /** The args of every run of one desk command. */
  ran(name: string): unknown[];
  /** Wait until the plugin is quiet: calls answered and follow-up calls answered too. */
  settle(): Promise<void>;
}

/** The desk commands sheets runs, answered as the desk would. */
const DESK: Commands = {
  "desk.files.changed": () => "reloaded",
  "desk.buffers.update": () => ({}),
};

export async function mount(
  options: {
    handlers?: Handlers;
    commands?: Commands;
    settings?: Record<string, unknown>;
    open?: Open;
    /** What the last sleep kept (ctx.surface.restored). */
    restored?: unknown;
    /** False: resolve once mounted, without waiting for its calls (a test holds one back). */
    settled?: boolean;
  } = {},
): Promise<Mounted> {
  const host = createTestHost({
    pluginId: "endue.sheets",
    handlers: { "init.get": () => ({ profile: "default", settings: {} }), ...options.handlers },
    commands: { ...DESK, ...options.commands },
    settings: options.settings,
    ...(options.restored === undefined ? {} : { restored: options.restored }),
  });
  const view = recordingView();
  let app: Sheets | undefined;
  let mounted = false;
  await defineUiPlugin(
    {
      mount(ctx) {
        app = createSheets(ctx, view, {
          read: readBytes,
          open: options.open ?? openBook,
          keepFiles,
        });
        mounted = true;
      },
    },
    host.transport,
  );
  const settle = async () => {
    for (let i = 0; i < 4; i++) await host.settle();
  };
  if (options.settled !== false) await settle();
  if (!mounted) throw new Error("the plugin did not mount");
  return {
    host,
    view,
    app: app as Sheets,
    params: (method) => host.calls.filter((c) => c.method === method).map((c) => c.params),
    ran: (name) => host.ran.filter((r) => r.name === name).map((r) => r.args),
    settle,
  };
}

/** Base64 of bytes or of UTF-8 text, as fs.read answers with encoding "base64". */
export const base64 = (data: Uint8Array | string) =>
  Buffer.from(typeof data === "string" ? new TextEncoder().encode(data) : data).toString("base64");

/**
 * fs.read, fs.write (base64) and fs.watch over an in-memory disk of bytes; files missing from it are
 * not_found, and a write puts the bytes it was given there.
 */
export function disk(files: Record<string, Uint8Array | string>): Handlers {
  let watches = 0;
  return {
    "fs.read": ({ path, offset = 0, length }) => {
      const content = files[path];
      if (content === undefined) throw new StubError("not_found", `no file ${path}`);
      const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
      return {
        content: base64(bytes.subarray(offset, length === undefined ? undefined : offset + length)),
        encoding: "base64",
        size: bytes.length,
      };
    },
    "fs.write": ({ path, content, encoding }) => {
      if (encoding !== "base64") throw new StubError("invalid_params", "sheets writes base64");
      files[path] = new Uint8Array(Buffer.from(content, "base64"));
      return { bytesWritten: files[path].length };
    },
    "fs.watch": () => ({ watchId: `w${++watches}` }),
  };
}

export const denied = (what: string) =>
  new StubError("permission_denied", `${what} is not granted`);

/** A file's buffer and path, as the desk sends them in every request. */
export const file = (path: string) => ({ buffer: `file:${path}`, path });

/** A fixture from tests/fixtures, as bytes. */
export const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", name)));
