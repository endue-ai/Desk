// Mounts the player on the SDK's test host with a view that records what it was asked to show. The
// SDK is imported by its workspace path: plugin folders are not workspace packages yet.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StubError } from "../../../packages/bridge/src/index";
import { defineUiPlugin } from "../../../packages/plugin-sdk/src/index";
import { createTestHost, type TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { createPlayer, type Model, type PlayerOptions, type PlayerView } from "../ui/player.js";

type Options = Parameters<typeof createTestHost>[0];
export type Handlers = NonNullable<Options["handlers"]>;
export type Commands = NonNullable<Options["commands"]>;
export type Files = NonNullable<Options["files"]>;

export interface RecordingView {
  models: Array<Model | null>;
  statuses: string[];
  /** How many times the plugin moved the keyboard focus to its surface. */
  focused: number;
  /** Every media type the plugin asked canPlay about. */
  asked: string[];
  /** What canPlay answers: "maybe" for everything unless a test says otherwise. */
  playable: (type: string) => "" | "maybe" | "probably";
  show(model: Model | null): void;
  status(text: string): void;
  focus(): void;
  canPlay(type: string): "" | "maybe" | "probably";
}

export function recordingView(): RecordingView {
  const view: RecordingView = {
    models: [],
    statuses: [],
    focused: 0,
    asked: [],
    playable: () => "maybe",
    show: (model) => view.models.push(model === null ? null : structuredClone(model)),
    status: (text) => view.statuses.push(text),
    focus: () => {
      view.focused++;
    },
    canPlay: (type) => {
      view.asked.push(type);
      return view.playable(type);
    },
  };
  return view;
}

export interface Mounted<V extends PlayerView = RecordingView> {
  host: TestHost;
  view: V;
  app: ReturnType<typeof createPlayer>;
  /** The model on screen. */
  shown(): Model | null;
  params(method: string): unknown[];
  ran(name: string): unknown[];
  /** The values the plugin stored with store.set, by key. */
  store: Record<string, unknown>;
  settle(): Promise<void>;
}

const DESK: Commands = { "desk.files.changed": () => "reloaded" };

/** fs.list over the test's files: the names directly inside a folder. */
export function listing(files: Files): Handlers["fs.list"] {
  return ({ path }) => {
    const names = Object.keys(files)
      .filter((p) => p.slice(0, p.lastIndexOf("/")) === path)
      .map((p) => p.slice(p.lastIndexOf("/") + 1));
    if (names.length === 0) throw new StubError("not_found", `${path} does not exist`);
    return { entries: names.sort().map((name) => ({ name, kind: "file" as const })) };
  };
}

export interface MountOptions {
  files?: Files;
  /** fs:read paths granted at start; none by default, so the first visit asks. */
  grants?: string[];
  handlers?: Handlers;
  commands?: Commands;
  /** Settings init.get answers with (endue.player.*). */
  init?: Record<string, unknown>;
  store?: Record<string, unknown>;
  prompt?: Options["prompt"];
  options?: Partial<PlayerOptions>;
}

export async function mount<V extends PlayerView = RecordingView>(
  options: MountOptions & { view?: V } = {},
): Promise<Mounted<V>> {
  const files = options.files ?? {};
  const store: Record<string, unknown> = { ...options.store };
  let watches = 0;
  const host = createTestHost({
    pluginId: "endue.player",
    files,
    grants: (options.grants ?? []).map((path) => ({ permission: "fs:read", paths: [path] })),
    prompt: options.prompt,
    handlers: {
      "fs.list": listing(files),
      "fs.watch": () => ({ watchId: `w${++watches}` }),
      "store.get": ({ key }) => (key in store ? { value: store[key] } : {}),
      "store.set": ({ key, value }) => {
        store[key] = value;
        return {};
      },
      "init.get": () => ({ profile: "default", settings: options.init ?? {} }),
      ...options.handlers,
    },
    commands: { ...DESK, ...options.commands },
  });
  const view = (options.view ?? recordingView()) as V;
  let app: ReturnType<typeof createPlayer> | undefined;
  let urls = 0;
  const player: PlayerOptions = {
    objectUrl: () => `blob:endue.player/${++urls}`,
    revokeUrl: () => {},
    ...options.options,
  };
  await defineUiPlugin(
    {
      mount(ctx) {
        app = createPlayer(ctx, view, player);
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
    shown: () => (view as Partial<RecordingView>).models?.at(-1) ?? null,
    params: (method) => host.calls.filter((c) => c.method === method).map((c) => c.params),
    ran: (name) => host.ran.filter((r) => r.name === name).map((r) => r.args),
    store,
    settle,
  };
}

/** A file's buffer and path, as the desk sends them in every request. */
export const file = (path: string) => ({ buffer: `file:${path}`, path });

export const denied = (what: string) =>
  new StubError("permission_denied", `${what} is not granted`);

/** A fixture made by make-fixtures.sh. */
export const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", name)));

/** The scope the player asks for and reads under: the file's folder. */
export const folderScope = (folder: string) =>
  ({ permission: "fs:read", paths: [`${folder}/**`] }) as const;
