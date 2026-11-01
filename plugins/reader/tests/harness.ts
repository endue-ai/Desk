// Mounts the reader on the SDK's test host, with a view that records what it was asked to show or
// with the real DOM view (view.test.ts). The SDK is imported by its workspace path: plugin folders
// are not workspace packages yet. Books open through the reader's own openers; PDFs through the
// vendored pdf.js (tests/pdfjs.ts).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StubError } from "../../../packages/bridge/src/index";
import { byteSource, defineUiPlugin, readBytes } from "../../../packages/plugin-sdk/src/index";
import { createTestHost, type TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { createReader, type ShownModel } from "../ui/reader.js";
import { loadPdfjs } from "./pdfjs";

type Options = Parameters<typeof createTestHost>[0];
export type Handlers = NonNullable<Options["handlers"]>;
export type Commands = NonNullable<Options["commands"]>;
export type Reader = ReturnType<typeof createReader>;

/** What the controller asks of a view. */
export interface View {
  show(model: ShownModel | null): void;
  marks(model: ShownModel): void;
  status(text: string): void;
  focus(): void;
}

export interface RecordingView extends View {
  shown: Array<ShownModel | null>;
  statuses: string[];
  focused: number;
}

export function recordingView(): RecordingView {
  const view: RecordingView = {
    shown: [],
    statuses: [],
    focused: 0,
    show: (model) => view.shown.push(model),
    marks: () => {},
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
  app: Reader;
  params(method: string): unknown[];
  ran(name: string): unknown[];
  settle(): Promise<void>;
}

const DESK: Commands = { "desk.files.changed": () => "reloaded" };

export async function mount<V extends View = RecordingView>(
  options: {
    handlers?: Handlers;
    commands?: Commands;
    pdfjs?: () => Promise<object>;
    view?: (app: () => Reader | undefined) => V;
  } = {},
): Promise<Mounted<V>> {
  const host = createTestHost({
    pluginId: "endue.reader",
    handlers: options.handlers ?? {},
    commands: { ...DESK, ...options.commands },
  });
  let app: Reader | undefined;
  const view = (options.view?.(() => app) ?? recordingView()) as V;
  await defineUiPlugin(
    {
      mount(ctx) {
        app = createReader(ctx, view, { pdfjs: options.pdfjs ?? loadPdfjs, byteSource, readBytes });
      },
    },
    host.transport,
  );
  const settle = async () => {
    for (let i = 0; i < 8; i++) await host.settle();
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

/** fs.read (base64) and fs.watch over an in-memory disk; store.get and store.set over `store`. */
export function disk(
  files: Record<string, Uint8Array>,
  store: Record<string, unknown> = {},
): Handlers {
  let watches = 0;
  return {
    "fs.read": ({ path, encoding, offset = 0, length }) => {
      const bytes = files[path];
      if (bytes === undefined) throw new StubError("not_found", `no file ${path}`);
      if (encoding !== "base64") throw new StubError("invalid_params", "the reader reads base64");
      return {
        content: Buffer.from(
          bytes.slice(offset, length === undefined ? undefined : offset + length),
        ).toString("base64"),
        encoding: "base64",
        size: bytes.length,
      };
    },
    "fs.watch": () => ({ watchId: `w${++watches}` }),
    "store.get": ({ key }) => (key in store ? { value: store[key] } : {}),
    "store.set": ({ key, value }) => {
      store[key] = value;
      return {};
    },
  };
}

export const denied = (what: string) =>
  new StubError("permission_denied", `${what} is not granted`);

/** A file's buffer and path, as the desk sends them in every request. */
export const file = (path: string) => ({ buffer: `file:${path}`, path });

/** The read scope the reader asks with: the file's folder. */
export const folderScope = (path: string) =>
  ({ permission: "fs:read", paths: [`${path.slice(0, path.lastIndexOf("/"))}/**`] }) as const;

/** The plugin's page, for the DOM view: ui/index.html's body. */
export function loadPage(doc: Document) {
  const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
  const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  doc.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, "");
}
