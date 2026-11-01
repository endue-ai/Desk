// Mounts the data plugin on the SDK's test host, with a view that records what it was asked to show
// or, in jsdom, with the real view on the plugin's own index.html. The SDK is imported by its
// workspace path: plugin folders are not workspace packages yet.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StubError } from "../../../packages/bridge/src/index";
import { defineUiPlugin, readBytes } from "../../../packages/plugin-sdk/src/index";
import { createTestHost, type TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { createData, type SchemaState, type Shown } from "../ui/data.js";
import { createView } from "../ui/view.js";

type Options = Parameters<typeof createTestHost>[0];
export type Handlers = NonNullable<Options["handlers"]>;
export type Commands = NonNullable<Options["commands"]>;

export interface RecordingView {
  shown: Array<Shown | null>;
  schemas: Array<{ buffer: string; state: SchemaState }>;
  masks: boolean[];
  statuses: string[];
  /** How many times the plugin moved the keyboard focus to its surface. */
  focused: number;
  show(model: Shown | null): void;
  schema(buffer: string, state: SchemaState): void;
  mask(keys: boolean): void;
  status(text: string): void;
  focus(): void;
}

export function recordingView(): RecordingView {
  const view: RecordingView = {
    shown: [],
    schemas: [],
    masks: [],
    statuses: [],
    focused: 0,
    show: (model) => view.shown.push(model),
    schema: (buffer, state) => view.schemas.push({ buffer, state }),
    mask: (keys) => view.masks.push(keys),
    status: (text) => view.statuses.push(text),
    focus: () => {
      view.focused++;
    },
  };
  return view;
}

type AnyView = Parameters<typeof createData>[1];

export interface Mounted<V> {
  host: TestHost;
  view: V;
  app: ReturnType<typeof createData>;
  /** The params of every call to one bridge method. */
  params(method: string): unknown[];
  /** The args of every run of one desk command. */
  ran(name: string): unknown[];
  /** Wait until the plugin is quiet: calls answered and follow-up calls answered too. */
  settle(): Promise<void>;
}

/** The desk commands the plugin runs, answered as the desk would. */
const DESK: Commands = {
  "desk.files.changed": () => "reloaded",
};

interface MountOptions {
  handlers?: Handlers;
  commands?: Commands;
  settings?: Record<string, unknown>;
}

async function mountWith<V extends AnyView>(view: V, options: MountOptions): Promise<Mounted<V>> {
  const host = createTestHost({
    pluginId: "endue.data",
    handlers: options.handlers ?? {},
    commands: { ...DESK, ...options.commands },
    settings: options.settings,
  });
  let app: ReturnType<typeof createData> | undefined;
  await defineUiPlugin(
    {
      mount(ctx) {
        app = createData(ctx, view, { readBytes });
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

export const mount = (options: MountOptions = {}) => mountWith(recordingView(), options);

/** The plugin's index.html, without its scripts, as the document's body. Needs jsdom. */
export function loadPage(doc: Document = document) {
  const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
  const body = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "";
  doc.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, "");
  return doc;
}

/** The real view on the plugin's page, joined to the controller as ui/main.js does. Needs jsdom. */
export async function mountPage(options: MountOptions = {}) {
  loadPage();
  let app: ReturnType<typeof createData> | undefined;
  const view = createView(document, { validateWith: () => app?.validateWith() });
  const mounted = await mountWith(view, options);
  app = mounted.app;
  return mounted;
}

const base64 = (content: string | Uint8Array) => Buffer.from(content).toString("base64");

/**
 * fs.read, fs.list and fs.watch over an in-memory disk (files missing from it are not_found), and
 * store.get and store.set over an in-memory store.
 */
export function disk(
  files: Record<string, string | Uint8Array>,
  store: Record<string, unknown> = {},
): Handlers {
  let watches = 0;
  return {
    "store.get": ({ key }) => (key in store ? { value: store[key] } : {}),
    "store.set": ({ key, value }) => {
      store[key] = value;
      return {};
    },
    "fs.read": ({ path, encoding, offset = 0, length }) => {
      const content = files[path];
      if (content === undefined) throw new StubError("not_found", `no file ${path}`);
      if (encoding === "base64") {
        const bytes = Buffer.from(content);
        return {
          content: base64(
            bytes.subarray(offset, length === undefined ? undefined : offset + length),
          ),
          encoding: "base64",
          size: bytes.length,
        };
      }
      return { content: Buffer.from(content).toString("utf8"), encoding: "utf8" };
    },
    "fs.list": ({ path }) => ({
      entries: Object.keys(files)
        .filter((name) => name.slice(0, name.lastIndexOf("/")) === path)
        .map((name) => ({ name: name.slice(name.lastIndexOf("/") + 1), kind: "file" as const })),
    }),
    "fs.watch": () => ({ watchId: `w${++watches}` }),
  };
}

export const denied = (what: string) =>
  new StubError("permission_denied", `${what} is not granted`);

/** A file's buffer and path, as the desk sends them in every request. */
export const file = (path: string) => ({ buffer: `file:${path}`, path });

/** The fs:read scope the plugin asks for and reads with: the file's folder. */
export const folderRead = (path: string) =>
  ({ permission: "fs:read", paths: [`${path.slice(0, path.lastIndexOf("/"))}/**`] }) as const;

/** Where `needle` first starts in `text`, 1-based, as the parsers count lines and columns. */
export function at(text: string, needle: string, from = 0) {
  const offset = text.indexOf(needle, from);
  if (offset < 0) throw new Error(`${needle} is not in the text`);
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  return { line, col: offset - before.lastIndexOf("\n") };
}

export const bytesOf = (text: string) => new TextEncoder().encode(text);
