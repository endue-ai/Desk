// Mounts the explorer on the SDK's test host over an in-memory disk, with a view that records what
// it was asked to show. The SDK is imported by its workspace path: plugin folders are not workspace
// packages yet.
import { type DirEntry, StubError } from "../../../packages/bridge/src/index";
import { defineUiPlugin } from "../../../packages/plugin-sdk/src/index";
import { createTestHost, type TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { createExplorer, type Header } from "../ui/explorer.js";
import type { Row } from "../ui/tree.js";

type Options = Parameters<typeof createTestHost>[0];
export type Handlers = NonNullable<Options["handlers"]>;
export type Commands = NonNullable<Options["commands"]>;

export interface RecordingView {
  trees: Array<{ rows: Row[]; selected: string | null }>;
  headers: Header[];
  statuses: string[];
  /** Every row the plugin moved the keyboard focus to (null: the tree itself). */
  focused: Array<string | null>;
  tree(rows: Row[], selected: string | null): void;
  header(header: Header): void;
  status(text: string): void;
  focus(id: string | null): void;
  /** The latest tree, one line per row: `depth:kind:name`, `+` when expanded, `!` on an error. */
  shown(): string[];
  selected(): string | null;
}

export function recordingView(): RecordingView {
  const view: RecordingView = {
    trees: [],
    headers: [],
    statuses: [],
    focused: [],
    tree: (rows, selected) => view.trees.push({ rows, selected }),
    header: (header) => view.headers.push(header),
    status: (text) => view.statuses.push(text),
    focus: (id) => view.focused.push(id),
    shown: () =>
      (view.trees.at(-1)?.rows ?? []).map(
        (row) =>
          `${row.depth}:${row.kind}:${row.name}${row.expanded ? "+" : ""}${row.error ? "!" : ""}`,
      ),
    selected: () => view.trees.at(-1)?.selected ?? null,
  };
  return view;
}

export interface Mounted {
  host: TestHost;
  view: RecordingView;
  app: ReturnType<typeof createExplorer>;
  /** The params of every call to one bridge method. */
  params(method: string): unknown[];
  /** The args of every run of one desk command. */
  ran(name: string): unknown[];
  /** Wait until the plugin is quiet: calls answered and follow-up calls answered too. */
  settle(): Promise<void>;
}

/** A folder tree for the in-memory disk: folder path -> its entries. */
export type Tree = Record<string, DirEntry[]>;

export const file = (name: string, size = 1): DirEntry => ({ name, kind: "file", size });
export const dir = (name: string): DirEntry => ({ name, kind: "dir" });
export const link = (name: string): DirEntry => ({ name, kind: "symlink" });

/** fs.list, fs.write and fs.watch over an in-memory tree; folders missing from it are not_found. */
export function disk(tree: Tree, written: Array<{ path: string; content: string }> = []): Handlers {
  let watches = 0;
  return {
    "fs.list": ({ path }) => {
      const entries = tree[path];
      if (entries === undefined) throw new StubError("not_found", `no folder ${path}`);
      return { entries: entries.map((e) => ({ ...e })) };
    },
    "fs.write": ({ path, content }) => {
      const slash = path.lastIndexOf("/");
      const folder = path.slice(0, slash);
      const name = path.slice(slash + 1);
      const entries = tree[folder];
      if (entries === undefined) throw new StubError("not_found", `no folder ${folder}`);
      const existing = entries.find((e) => e.name === name);
      if (existing) existing.size = content.length;
      else entries.push(file(name, content.length));
      written.push({ path, content });
      return { bytesWritten: content.length };
    },
    "fs.watch": () => ({ watchId: `w${++watches}` }),
  };
}

export const denied = (what: string) =>
  new StubError("permission_denied", `${what} is not granted`);

/** The core's store and init.yaml, in memory. */
function core(store: Record<string, unknown>, init: Record<string, unknown>): Handlers {
  return {
    "store.get": ({ key }) => (key in store ? { value: store[key] } : {}),
    "store.set": ({ key, value }) => {
      store[key] = value;
      return {};
    },
    "init.get": () => ({ profile: "default", settings: init }),
  };
}

export interface MountOptions {
  handlers?: Handlers;
  commands?: Commands;
  /** The plugin's settings in the core at start (bare keys). */
  settings?: Record<string, unknown>;
  /** init.yaml settings, by full name. */
  init?: Record<string, unknown>;
  /** The store at start; the plugin writes into it. */
  store?: Record<string, unknown>;
  /** What desk.buffers.list answers. */
  buffers?: unknown[];
  /** What desk.palette.pick answers; undefined cancels the pick. */
  pick?: (args: unknown) => string | undefined;
}

export const DOCS = "~/Documents";
export const READ = { permission: "fs:read", paths: [`${DOCS}/**`] } as const;
export const WRITE = { permission: "fs:write", paths: [`${DOCS}/**`] } as const;

/** A documents folder with a sub-folder, a dotfolder, files out of natural order and a link. */
export const sample = (): Tree => ({
  [DOCS]: [
    file("b.txt", 2048),
    file("a10.md"),
    dir(".git"),
    file("a2.md"),
    dir("Work"),
    link("zed"),
  ],
  [`${DOCS}/Work`]: [file("c.md"), dir("deep")],
  [`${DOCS}/Work/deep`]: [file("x.md")],
  [`${DOCS}/.git`]: [file("HEAD")],
});

export async function mount(options: MountOptions = {}): Promise<Mounted> {
  const store = options.store ?? {};
  const commands: Commands = {
    "desk.files.open": (args) => `file:${(args as { path: string }).path}`,
    "desk.buffers.list": () => options.buffers ?? [],
    "desk.palette.pick": (args) => {
      const answer = options.pick?.(args);
      if (answer === undefined) throw Object.assign(new Error("nothing was picked"), {});
      return answer;
    },
    ...options.commands,
  };
  const host = createTestHost({
    pluginId: "endue.explorer",
    handlers: { ...core(store, options.init ?? {}), ...options.handlers },
    commands,
    settings: options.settings,
  });
  const view = recordingView();
  let app: ReturnType<typeof createExplorer> | undefined;
  await defineUiPlugin(
    {
      async mount(ctx) {
        app = createExplorer(ctx, view, { debounceMs: 0 });
        await app.start();
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
