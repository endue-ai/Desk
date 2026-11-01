// Mounts the Docker plugin on the SDK's test host with a scripted docker behind `proc.spawn` and a
// view that records what it was asked to show. The SDK is imported by its workspace path: plugin
// folders are not workspace packages yet.
import type { Signal } from "../../../packages/bridge/src/index";
import { CommandFailed, defineUiPlugin } from "../../../packages/plugin-sdk/src/index";
import { createTestHost, type TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import type { Item } from "../ui/actions.js";
import { wireCommands } from "../ui/commands.js";
import { createDocker, type Header, type LogsView, type View } from "../ui/docker.js";
import type { Detail } from "../ui/inspect.js";
import type {
  ComposeModel,
  ContainersModel,
  ImagesModel,
  NetworksModel,
  SystemModel,
  VolumesModel,
} from "../ui/lists.js";
import {
  CONTEXTS,
  DISK,
  IMAGES,
  INSPECT,
  NETWORKS,
  PROJECTS,
  PS,
  STATS,
  VERSION,
  VOLUMES,
} from "./fixtures";

type Options = Parameters<typeof createTestHost>[0];
export type Handlers = NonNullable<Options["handlers"]>;
export type Commands = NonNullable<Options["commands"]>;

export interface DockerCall {
  procId: string;
  /** The arguments after any `--context NAME`. */
  args: string[];
  context?: string;
  cwd?: string;
  env?: Record<string, string>;
}

export interface Reply {
  stdout?: string;
  stderr?: string;
  code?: number;
  /** Write stdout, then never exit until killed (a stream). */
  hang?: boolean;
}

export type Script = (call: DockerCall) => Reply | undefined;

export interface FakeDocker {
  handlers: Handlers;
  calls: DockerCall[];
  killed: Array<{ procId: string; signal: Signal | undefined }>;
  /** The arguments of every run whose first argument (after compose's flags) is `sub`. */
  of(sub: string): string[][];
  /** The latest call whose arguments start with `prefix`. */
  last(...prefix: string[]): DockerCall | undefined;
  /** Write lines to a running stream, as docker would. */
  write(procId: string, text: string, stream?: "stdout" | "stderr"): void;
  /** End a running stream with an exit code. */
  exit(procId: string, code: number, stderr?: string): void;
  attach(host: TestHost): void;
}

/** docker behind proc.spawn: each spawn answers from the script, as output events and an exit. */
export function fakeDocker(script: Script): FakeDocker {
  let host: TestHost | undefined;
  let n = 0;
  const calls: DockerCall[] = [];
  const hanging = new Set<string>();
  const killed: FakeDocker["killed"] = [];
  const emit = (event: Parameters<TestHost["emit"]>[0]) => host?.emit(event);
  const write: FakeDocker["write"] = (procId, text, stream = "stdout") =>
    emit({ event: "proc.output", data: { procId, stream, data: text, encoding: "utf8" } });
  const handlers: Handlers = {
    "proc.spawn": (params) => {
      if (params.command !== "docker") throw new Error(`not docker: ${params.command}`);
      const argv = [...(params.args ?? [])];
      const context = argv[0] === "--context" ? argv.splice(0, 2)[1] : undefined;
      const procId = `p${++n}`;
      const call: DockerCall = {
        procId,
        args: argv,
        ...(context ? { context } : {}),
        ...(params.cwd ? { cwd: params.cwd } : {}),
        ...(params.env ? { env: params.env } : {}),
      };
      calls.push(call);
      const reply = script(call) ?? {};
      if (reply.hang) hanging.add(procId);
      setTimeout(() => {
        if (reply.stdout) write(procId, reply.stdout);
        if (reply.stderr) write(procId, reply.stderr, "stderr");
        if (!reply.hang) emit({ event: "proc.exit", data: { procId, code: reply.code ?? 0 } });
      }, 0);
      return { procId, pid: 1000 + n };
    },
    "proc.kill": ({ procId, signal }) => {
      killed.push({ procId, signal });
      if (hanging.delete(procId))
        setTimeout(
          () => emit({ event: "proc.exit", data: { procId, signal: signal ?? "term" } }),
          0,
        );
      return {};
    },
  };
  const sub = (args: string[]) =>
    args[0] === "compose"
      ? args.find((a, i) => i > 4 && !a.startsWith("-") && args[i - 1] !== "-f")
      : args[0];
  return {
    handlers,
    calls,
    killed,
    of: (name) => calls.filter((c) => sub(c.args) === name).map((c) => c.args),
    last: (...prefix) =>
      [...calls].reverse().find((c) => prefix.every((part, i) => c.args[i] === part)),
    write,
    exit: (procId, code, stderr) => {
      if (stderr) write(procId, stderr, "stderr");
      hanging.delete(procId);
      emit({ event: "proc.exit", data: { procId, code } });
    },
    attach: (h) => {
      host = h;
    },
  };
}

/**
 * An engine that answers the reads the views need from the fixtures, with overrides keyed by the
 * joined arguments (a key matches when the call's arguments start with it). `events` hangs.
 */
export function engine(table: Record<string, Reply | ((call: DockerCall) => Reply)> = {}): Script {
  const defaults: Record<string, Reply> = {
    version: { stdout: VERSION },
    "ps -a": { stdout: PS },
    ps: { stdout: PS },
    "compose --ansi never ls": { stdout: PROJECTS },
    "image ls": { stdout: IMAGES },
    "volume ls": { stdout: VOLUMES },
    "network ls": { stdout: NETWORKS },
    stats: { stdout: STATS },
    "system df": { stdout: DISK },
    "context ls": { stdout: CONTEXTS },
    "container inspect": { stdout: INSPECT },
    events: { hang: true },
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
  lists: Array<{ name: string; model: unknown }>;
  logViews: LogsView[];
  details: Array<Detail | null>;
  said: string[];
  busy_: number[];
  selected: Item | undefined;
  /** The latest model drawn for a list. */
  latest<K extends keyof Models>(name: K): Models[K];
}

/** The model each list draws. */
interface Models {
  containers: ContainersModel;
  compose: ComposeModel;
  images: ImagesModel;
  volumes: VolumesModel;
  networks: NetworksModel;
  system: SystemModel;
}

export function recordingView(): RecordingView {
  const view: RecordingView = {
    headers: [],
    shown: [],
    hints: [],
    lists: [],
    logViews: [],
    details: [],
    said: [],
    busy_: [],
    selected: undefined,
    latest: <K extends keyof Models>(name: K) =>
      [...view.lists].reverse().find((l) => l.name === name)?.model as Models[K],
    header: (h) => view.headers.push(h),
    show: (name, hints) => {
      view.shown.push(name);
      view.hints.push(hints);
    },
    list: (name, model) => view.lists.push({ name, model }),
    logs: (model) => view.logViews.push({ ...model, lines: [...model.lines] }),
    detail: (model) => view.details.push(model),
    say: (text) => view.said.push(text),
    busy: (n) => view.busy_.push(n),
    focus: () => {},
    selection: () => view.selected,
  };
  return view;
}

/** A clock whose timers run only when the test moves it. */
export function fakeClock(start = 1_793_426_838_000) {
  let now = start;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock = {
    now: () => now,
    setTimeout: ((fn: () => void, ms = 0) => {
      const id = next++;
      timers.set(id, { at: now + ms, fn });
      return id;
    }) as unknown as typeof setTimeout,
    clearTimeout: ((id: number) => {
      timers.delete(id);
    }) as unknown as typeof clearTimeout,
    /** Move time on by `ms`, running every timer that comes due, in order. */
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = Math.max(now, due[1].at);
        due[1].fn();
      }
      now = end;
    },
    pending: () => timers.size,
  };
  return clock;
}

/** The desk commands the plugin runs, answered as the desk would. */
function deskCommands(nextBuffer: () => number): Commands {
  return {
    "desk.palette.pick": () => "",
    "desk.buffers.open": () => `endue.docker:${nextBuffer()}`,
    "desk.buffers.update": () => true,
    "desk.files.open": () => "opened",
    "endue.terminal.run": () => ({ session: "t1", procId: "p99" }),
  };
}

export interface Mounted {
  host: TestHost;
  view: RecordingView;
  app: ReturnType<typeof createDocker>;
  keys: Record<string, (...args: unknown[]) => unknown>;
  docker: FakeDocker;
  store: Record<string, unknown>;
  clock: ReturnType<typeof fakeClock>;
  params(method: string): unknown[];
  ran(name: string): unknown[];
  settle(): Promise<void>;
}

export async function mount(
  options: {
    script?: Script;
    handlers?: Handlers;
    commands?: Record<string, ((args: unknown) => unknown) | undefined>;
    state?: unknown;
    init?: Record<string, unknown>;
    store?: Record<string, unknown>;
    /** Run on the platform's timers instead of the fake clock. */
    systemClock?: boolean;
  } = {},
): Promise<Mounted> {
  const docker = fakeDocker(options.script ?? engine());
  const store: Record<string, unknown> = { ...options.store };
  const clock = fakeClock();
  let buffers = 0;
  const host = createTestHost({
    pluginId: "endue.docker",
    state: options.state,
    handlers: {
      "store.get": ({ key }) => (key in store ? { value: store[key] } : {}),
      "store.set": ({ key, value }) => {
        store[key] = value;
        return {};
      },
      "init.get": () => ({
        profile: "default",
        settings: { "endue.docker.stats-interval": 0, ...options.init },
      }),
      "ui.notify": () => ({ notificationId: "n1" }),
      ...docker.handlers,
      ...options.handlers,
    },
    // A command given as undefined is not registered at all: running it is unknown_command.
    commands: Object.fromEntries(
      Object.entries({ ...deskCommands(() => ++buffers), ...options.commands }).filter(
        ([, run]) => run !== undefined,
      ),
    ) as Commands,
  });
  docker.attach(host);
  const view = recordingView();
  let app: ReturnType<typeof createDocker> | undefined;
  let keys: Record<string, (...args: unknown[]) => unknown> = {};
  await defineUiPlugin(
    {
      mount(ctx) {
        const cancelled = (message: string) =>
          new CommandFailed("endue.docker.cancel", "cancelled", message);
        app = createDocker(ctx, view, {
          ...(options.systemClock ? {} : { clock }),
          flushMs: 0,
          cancelled,
        });
        keys = wireCommands(ctx, app, view);
      },
    },
    host.transport,
  );
  const settle = async () => {
    for (let i = 0; i < 8; i++) {
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
    keys,
    docker,
    store,
    clock,
    params: (method) => host.calls.filter((c) => c.method === method).map((c) => c.params),
    ran: (name) => host.ran.filter((r) => r.name === name).map((r) => r.args),
    settle,
  };
}
