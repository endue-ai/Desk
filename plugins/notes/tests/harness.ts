// Mounts the notes plugin on the SDK's test host with a view that records what it was asked to show.
// The SDK is imported by its workspace path: plugin folders are not workspace packages yet.
import { type DirEntry, StubError } from "../../../packages/bridge/src/index";
import {
  applyTextChange,
  defineUiPlugin,
  isTextChange,
  keepFiles,
  textChange,
} from "../../../packages/plugin-sdk/src/index";
import { createTestHost, type TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { createNotes, type NoteModel } from "../ui/notes.js";

type Options = Parameters<typeof createTestHost>[0];
export type Handlers = NonNullable<Options["handlers"]>;
export type Commands = NonNullable<Options["commands"]>;

/** Where the text area's caret and scroll are. */
export interface Place {
  start: number;
  end: number;
  scroll: number;
}

export interface RecordingView {
  notes: Array<NoteModel | null>;
  statuses: string[];
  /** How many times the plugin moved the keyboard focus to its text area. */
  focused: number;
  /** The caret and scroll `where()` reports, as a person left them. */
  at: Place;
  /** Every caret and scroll the plugin put back. */
  places: Place[];
  /** Every text a drop put in at the caret. */
  inserted: string[];
  /** The page's stand-in as a drop target, and a spot on it for `host.dnd.drop({ over })`. */
  dropTarget: object;
  spot: { parentNode: object };
  landing(element: unknown): unknown;
  insert(text: string): void;
  note(model: NoteModel | null): void;
  status(text: string): void;
  focus(): void;
  where(): Place;
  place(at: Place): void;
}

export function recordingView(): RecordingView {
  const view: RecordingView = {
    notes: [],
    statuses: [],
    focused: 0,
    at: { start: 0, end: 0, scroll: 0 },
    places: [],
    inserted: [],
    dropTarget: {},
    spot: { parentNode: {} },
    landing: (element) => element,
    insert: (text) => view.inserted.push(text),
    note: (model) => view.notes.push(model),
    status: (text) => view.statuses.push(text),
    focus: () => {
      view.focused++;
    },
    where: () => ({ ...view.at }),
    place: (at) => view.places.push(at),
  };
  view.spot = { parentNode: view.dropTarget };
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
  options: { handlers?: Handlers; commands?: Commands; restored?: unknown } = {},
): Promise<Mounted> {
  const host = createTestHost({
    pluginId: "endue.notes",
    handlers: options.handlers ?? {},
    commands: { ...DESK, ...options.commands },
    ...(options.restored === undefined ? {} : { restored: options.restored }),
  });
  const view = recordingView();
  let app: ReturnType<typeof createNotes> | undefined;
  await defineUiPlugin(
    {
      async mount(ctx) {
        app = createNotes(ctx, view, { keepFiles, textChange, applyTextChange, isTextChange });
        await app.ready;
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

/** What `fs.list` says of the in-memory disk besides names: modification times and symlinks. */
export interface DiskMeta {
  /** modifiedAt by file path; a file without one is listed without it. */
  times?: Record<string, string>;
  /** Paths listed as symlinks, whatever they point at. */
  links?: string[];
}

/**
 * fs.read, fs.write, fs.watch and fs.list over an in-memory disk; files missing from it are
 * not_found. Folders are the paths the files are under.
 */
export function disk(files: Record<string, string>, meta: DiskMeta = {}): Handlers {
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
    "fs.list": ({ path }) => {
      const prefix = `${path}/`;
      const entries = new Map<string, DirEntry>();
      for (const [file, content] of Object.entries(files)) {
        if (!file.startsWith(prefix)) continue;
        const [name = "", ...rest] = file.slice(prefix.length).split("/");
        const at = meta.times?.[file];
        if (meta.links?.includes(`${prefix}${name}`)) entries.set(name, { name, kind: "symlink" });
        else if (rest.length > 0) entries.set(name, { name, kind: "dir" });
        else
          entries.set(name, {
            name,
            kind: "file",
            size: new TextEncoder().encode(content).length,
            ...(at ? { modifiedAt: at } : {}),
          });
      }
      if (entries.size === 0) throw new StubError("not_found", `no folder ${path}`);
      return { entries: [...entries.values()] };
    },
  };
}

export const denied = (what: string) =>
  new StubError("permission_denied", `${what} is not granted`);

/** A note's buffer and path, as the desk sends them in every request. */
export const note = (path: string) => ({ buffer: `file:${path}`, path });

export const NOTES_READ = { permission: "fs:read", paths: ["~/Notes/**"] } as const;
export const NOTES_WRITE = { permission: "fs:write", paths: ["~/Notes/**"] } as const;
