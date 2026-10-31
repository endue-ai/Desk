// Mounts the Git plugin on the SDK's test host with a scripted git behind `proc.spawn` and a view
// that records what it was asked to show. The SDK is imported by its workspace path: plugin folders
// are not workspace packages yet.
import type { Signal } from "../../../packages/bridge/src/index";
import { defineUiPlugin } from "../../../packages/plugin-sdk/src/index";
import { createTestHost, type TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import type { CommitEditor, Item } from "../ui/actions.js";
import {
  createGit,
  type DiffView,
  type Header,
  type LogView,
  type StatusView,
  type View,
} from "../ui/git.js";
import { GIT_FLAGS } from "../ui/run.js";

type Options = Parameters<typeof createTestHost>[0];
export type Handlers = NonNullable<Options["handlers"]>;
export type Commands = NonNullable<Options["commands"]>;

export interface GitCall {
  procId: string;
  /** The arguments after the runner's fixed flags. */
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface Reply {
  stdout?: string;
  stderr?: string;
  code?: number;
  /** Never exit until killed. */
  hang?: boolean;
}

export type Script = (call: GitCall) => Reply | undefined;

export interface FakeGit {
  handlers: Handlers;
  /** Every git run, in order. */
  calls: GitCall[];
  killed: Array<{ procId: string; signal: Signal | undefined }>;
  /** The arguments of every run of one subcommand. */
  of(sub: string): string[][];
  attach(host: TestHost): void;
}

/** git behind proc.spawn: each spawn answers from the script, as output events and an exit. */
export function fakeGit(script: Script): FakeGit {
  let host: TestHost | undefined;
  let n = 0;
  const calls: GitCall[] = [];
  const hanging = new Set<string>();
  const killed: FakeGit["killed"] = [];
  const emit = (event: Parameters<TestHost["emit"]>[0]) => host?.emit(event);
  const handlers: Handlers = {
    "proc.spawn": (params) => {
      if (params.command !== "git") throw new Error(`not git: ${params.command}`);
      const prefix = (params.args ?? []).slice(0, GIT_FLAGS.length);
      if (prefix.join(" ") !== GIT_FLAGS.join(" ")) throw new Error("the fixed flags are missing");
      const procId = `p${++n}`;
      const call: GitCall = {
        procId,
        args: (params.args ?? []).slice(GIT_FLAGS.length),
        ...(params.cwd ? { cwd: params.cwd } : {}),
        ...(params.env ? { env: params.env } : {}),
      };
      calls.push(call);
      const reply = script(call) ?? {};
      if (reply.hang) hanging.add(procId);
      else
        setTimeout(() => {
          if (reply.stdout)
            emit({
              event: "proc.output",
              data: { procId, stream: "stdout", data: reply.stdout, encoding: "utf8" },
            });
          if (reply.stderr)
            emit({
              event: "proc.output",
              data: { procId, stream: "stderr", data: reply.stderr, encoding: "utf8" },
            });
          emit({ event: "proc.exit", data: { procId, code: reply.code ?? 0 } });
        }, 0);
      return { procId, pid: 1000 + n };
    },
    "proc.kill": ({ procId, signal }) => {
      killed.push({ procId, signal });
      if (hanging.delete(procId)) {
        setTimeout(
          () => emit({ event: "proc.exit", data: { procId, signal: signal ?? "term" } }),
          0,
        );
      }
      return {};
    },
  };
  return {
    handlers,
    calls,
    killed,
    of: (sub) => calls.filter((c) => c.args[0] === sub).map((c) => c.args),
    attach: (h) => {
      host = h;
    },
  };
}

/** NUL-terminated records, as `git status -z` writes them. */
export const z = (...records: string[]) => records.map((r) => `${r}\0`).join("");

/** A clean repository on main, tracking origin/main, with one commit. */
export const CLEAN_STATUS = z(
  "# branch.oid 1111111111111111111111111111111111111111",
  "# branch.head main",
  "# branch.upstream origin/main",
  "# branch.ab +0 -0",
);

export const ROOT = "/Users/me/Project/Desk";

/**
 * The replies a repository at ROOT gives to the reads the status needs, with overrides keyed by the
 * joined arguments (a key matches when the call's arguments start with it).
 */
export function repository(table: Record<string, Reply | ((call: GitCall) => Reply)> = {}): Script {
  const defaults: Record<string, Reply> = {
    "rev-parse --show-toplevel": { stdout: `${ROOT}\n` },
    "status --porcelain=v2 --branch -z": { stdout: CLEAN_STATUS },
    "stash list": { stdout: "" },
    "log -n 10": { stdout: "1111111\x1fInitial commit\x1fHEAD -> main, origin/main\n" },
    remote: { stdout: "origin\n" },
  };
  return (call) => {
    const joined = call.args.join(" ");
    for (const [key, reply] of Object.entries(table))
      if (joined.startsWith(key)) return typeof reply === "function" ? reply(call) : reply;
    for (const [key, reply] of Object.entries(defaults)) if (joined.startsWith(key)) return reply;
    return {};
  };
}

export interface RecordingView extends View {
  headers: Header[];
  shown: string[];
  hints: string[];
  statuses: StatusView[];
  logs: LogView[];
  diffs: DiffView[];
  editors: Array<CommitEditor | null>;
  said: string[];
  busy_: number[];
  focused: number;
  selected: Item | undefined;
}

export function recordingView(): RecordingView {
  const view: RecordingView = {
    headers: [],
    shown: [],
    hints: [],
    statuses: [],
    logs: [],
    diffs: [],
    editors: [],
    said: [],
    busy_: [],
    focused: 0,
    selected: undefined,
    header: (h) => view.headers.push(h),
    show: (name, hints) => {
      view.shown.push(name);
      view.hints.push(hints);
    },
    status: (m) => view.statuses.push(m),
    log: (m) => view.logs.push(m),
    diff: (m) => view.diffs.push(m),
    commit: (m) => view.editors.push(m),
    say: (text) => view.said.push(text),
    busy: (n) => view.busy_.push(n),
    focus: () => {
      view.focused++;
    },
    selection: () => view.selected,
  };
  return view;
}

export interface Mounted {
  host: TestHost;
  view: RecordingView;
  app: ReturnType<typeof createGit>;
  git: FakeGit;
  store: Record<string, unknown>;
  params(method: string): unknown[];
  ran(name: string): unknown[];
  settle(): Promise<void>;
}

export async function mount(
  options: {
    script?: Script;
    handlers?: Handlers;
    commands?: Commands;
    state?: unknown;
    init?: Record<string, unknown>;
    store?: Record<string, unknown>;
  } = {},
): Promise<Mounted> {
  const git = fakeGit(options.script ?? repository());
  const store: Record<string, unknown> = { ...options.store };
  let buffers = 0;
  const host = createTestHost({
    pluginId: "endue.git",
    state: options.state,
    handlers: {
      "store.get": ({ key }) => (key in store ? { value: store[key] } : {}),
      "store.set": ({ key, value }) => {
        store[key] = value;
        return {};
      },
      "init.get": () => ({ profile: "default", settings: options.init ?? {} }),
      ...git.handlers,
      ...options.handlers,
    },
    commands: {
      "desk.palette.pick": () => "",
      "desk.buffers.open": () => `endue.git:${++buffers}`,
      "desk.buffers.update": () => true,
      "desk.files.open": () => "opened",
      ...options.commands,
    },
  });
  git.attach(host);
  const view = recordingView();
  let app: ReturnType<typeof createGit> | undefined;
  await defineUiPlugin(
    {
      mount(ctx) {
        app = createGit(ctx, view);
      },
    },
    host.transport,
  );
  const settle = async () => {
    for (let i = 0; i < 6; i++) {
      await host.settle();
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  };
  await settle();
  if (!app) throw new Error("the plugin did not mount");
  await app.ready;
  await settle();
  return {
    host,
    view,
    app,
    git,
    store,
    params: (method) => host.calls.filter((c) => c.method === method).map((c) => c.params),
    ran: (name) => host.ran.filter((r) => r.name === name).map((r) => r.args),
    settle,
  };
}
