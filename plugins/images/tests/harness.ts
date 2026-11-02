// Mounts the images plugin on the SDK's test host, with a view that records what it was asked to
// show, or with the real DOM view (view.test.ts). The SDK is imported by its workspace path: plugin
// folders are not workspace packages yet.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";
import { StubError } from "../../../packages/bridge/src/index";
import { defineUiPlugin, readBytes } from "../../../packages/plugin-sdk/src/index";
import { createTestHost, type TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { createImages, type ImagesState } from "../ui/images.js";

type Options = Parameters<typeof createTestHost>[0];
export type Handlers = NonNullable<Options["handlers"]>;
export type Commands = NonNullable<Options["commands"]>;

/** What the controller asks of a view. */
export interface View {
  render(state: ImagesState): void;
  status(text: string): void;
  focus(): void;
}

export interface RecordingView extends View {
  progress: ReturnType<typeof vi.fn>;
  states: ImagesState[];
  statuses: string[];
  focused: number;
}

export function recordingView(): RecordingView {
  const view: RecordingView = {
    progress: vi.fn(),
    states: [],
    statuses: [],
    focused: 0,
    render: (state) => view.states.push(state),
    status: (text) => view.statuses.push(text),
    focus: () => {
      view.focused++;
    },
  };
  return view;
}

export interface Mounted<V extends View> {
  host: TestHost;
  view: V;
  app: ReturnType<typeof createImages>;
  /** The params of every call to one bridge method. */
  params(method: string): unknown[];
  /** The args of every run of one desk command. */
  ran(name: string): unknown[];
  /** Wait until the plugin is quiet: calls answered and follow-up calls answered too. */
  settle(): Promise<void>;
}

/** The desk commands images runs, answered as the desk would. */
const DESK: Commands = {
  "desk.files.changed": () => "reloaded",
  "desk.files.open": () => null,
  "desk.buffers.close": () => true,
};

export async function mount<V extends View = RecordingView>(
  options: {
    handlers?: Handlers;
    commands?: Commands;
    view?: (app: () => ReturnType<typeof createImages> | undefined) => V;
    /** The SDK's startWorker, or a test's stand-in; without it every file decodes in place. */
    startWorker?: (url: string | URL, options?: { name?: string }) => Worker;
  } = {},
): Promise<Mounted<V>> {
  const host = createTestHost({
    pluginId: "endue.images",
    handlers: options.handlers ?? {},
    commands: { ...DESK, ...options.commands },
  });
  let app: ReturnType<typeof createImages> | undefined;
  const view = (options.view?.(() => app) ?? recordingView()) as V;
  await defineUiPlugin(
    {
      mount(ctx) {
        app = createImages(ctx, view, { read: readBytes, startWorker: options.startWorker });
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

const folderOf = (path: string) => path.slice(0, path.lastIndexOf("/"));
const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/**
 * fs.read (base64, in ranges, with the file's size), fs.list and fs.watch over an in-memory disk;
 * files missing from it are not_found. A folder lists the files directly in it.
 */
export function disk(files: Record<string, Uint8Array>): Handlers {
  let watches = 0;
  return {
    "fs.read": ({ path, encoding, offset = 0, length }) => {
      const bytes = files[path];
      if (bytes === undefined) throw new StubError("not_found", `no file ${path}`);
      if (encoding !== "base64") throw new StubError("invalid_params", "images reads base64");
      const part = bytes.subarray(offset, length === undefined ? undefined : offset + length);
      return {
        content: Buffer.from(part).toString("base64"),
        encoding: "base64",
        size: bytes.length,
      };
    },
    "fs.list": ({ path }) => ({
      entries: Object.keys(files)
        .filter((file) => folderOf(file) === path)
        .map((file) => ({ name: nameOf(file), kind: "file", size: files[file]?.length })),
    }),
    "fs.watch": () => ({ watchId: `w${++watches}` }),
  };
}

export const denied = (what: string) =>
  new StubError("permission_denied", `${what} is not granted`);

/** An image's buffer and path, as the desk sends them in every request. */
export const image = (path: string) => ({ buffer: `file:${path}`, path });

/** The read scope images asks with: the file's folder. */
export const folderScope = (path: string) =>
  ({ permission: "fs:read", paths: [`${folderOf(path)}/**`] }) as const;

/** A fixture from tests/fixtures (see make-fixtures.py). */
export const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", name)));
