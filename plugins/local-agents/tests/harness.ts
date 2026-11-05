// Mounts the Local agents plugin on the SDK's test host with scripted agent programs behind
// `proc.spawn` and a view that records every view model it was asked to draw. The SDK is imported
// by its workspace path: plugin folders are not workspace packages yet.
import { StubError } from "../../../packages/bridge/src/index";
import { CommandFailed, defineUiPlugin } from "../../../packages/plugin-sdk/src/index";
import { createTestHost, type TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import type { ViewModel } from "../ui/model.js";
import { startPlugin } from "../ui/plugin.js";
import { CLAUDE_STREAM, CODEX_STREAM, VERSIONS } from "./fixtures";

type Options = Parameters<typeof createTestHost>[0];
export type Handlers = NonNullable<Options["handlers"]>;

export interface ProgramCall {
  procId: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface Reply {
  stdout?: string;
  stderr?: string;
  code?: number;
  /** Write stdout, then never exit until killed or ended by the test. */
  hang?: boolean;
}

/** What a program answers; "missing" is a program that is not on PATH. */
export type Script = (call: ProgramCall) => Reply | "missing" | undefined;

export interface FakePrograms {
  handlers: Handlers;
  calls: ProgramCall[];
  killed: string[];
  /** The calls to one program, without the --version checks. */
  asked(command: string): ProgramCall[];
  write(procId: string, text: string, stream?: "stdout" | "stderr"): void;
  exit(procId: string, code: number): void;
  attach(host: TestHost): void;
}

/** Programs behind proc.spawn: each spawn answers from the script, as output events and an exit. */
export function fakePrograms(script: Script): FakePrograms {
  let host: TestHost | undefined;
  let n = 0;
  const calls: ProgramCall[] = [];
  const hanging = new Set<string>();
  const killed: string[] = [];
  const emit = (event: Parameters<TestHost["emit"]>[0]) => host?.emit(event);
  const write: FakePrograms["write"] = (procId, text, stream = "stdout") =>
    emit({ event: "proc.output", data: { procId, stream, data: text, encoding: "utf8" } });
  const handlers: Handlers = {
    "proc.spawn": (params) => {
      const procId = `p${++n}`;
      const call: ProgramCall = {
        procId,
        command: params.command,
        args: [...(params.args ?? [])],
        ...(params.cwd ? { cwd: params.cwd } : {}),
        ...(params.env ? { env: params.env } : {}),
      };
      const reply = script(call);
      if (reply === "missing")
        throw new StubError("not_found", `${params.command}: no such program`);
      calls.push(call);
      const r = reply ?? {};
      if (r.hang) hanging.add(procId);
      setTimeout(() => {
        if (r.stdout) write(procId, r.stdout);
        if (r.stderr) write(procId, r.stderr, "stderr");
        if (!r.hang) emit({ event: "proc.exit", data: { procId, code: r.code ?? 0 } });
      }, 0);
      return { procId, pid: 1000 + n };
    },
    "proc.kill": ({ procId }) => {
      killed.push(procId);
      if (hanging.delete(procId))
        setTimeout(() => emit({ event: "proc.exit", data: { procId, signal: "term" } }), 0);
      return {};
    },
  };
  return {
    handlers,
    calls,
    killed,
    asked: (command) =>
      calls.filter(
        (c) => c.command === command && !(c.args.length === 1 && c.args[0] === "--version"),
      ),
    write,
    exit: (procId, code) => {
      hanging.delete(procId);
      emit({ event: "proc.exit", data: { procId, code } });
    },
    attach: (h) => {
      host = h;
    },
  };
}

/**
 * A computer with some agent programs installed: `--version` answers from the fixtures, a
 * question from `answers` (by program), every other program is missing.
 */
export function computer(
  answers: Record<string, Reply | ((call: ProgramCall) => Reply | undefined)> = {
    claude: { stdout: CLAUDE_STREAM },
    codex: { stdout: CODEX_STREAM },
  },
): Script {
  return (call) => {
    const answer = answers[call.command];
    if (!answer) return "missing";
    // A function answers what it wants to; what it leaves undefined is answered as usual.
    const own = typeof answer === "function" ? answer(call) : undefined;
    if (own) return own;
    if (call.args.length === 1 && call.args[0] === "--version")
      return { stdout: VERSIONS[call.command] ?? "1.0.0\n" };
    return typeof answer === "function" ? {} : answer;
  };
}

export interface RecordingView {
  models: ViewModel[];
  said: string[];
  render(model: ViewModel): void;
  say(text: string): void;
  latest(): ViewModel;
}

export function recordingView(): RecordingView {
  const view: RecordingView = {
    models: [],
    said: [],
    render: (model) => view.models.push(structuredClone(model)),
    say: (text) => view.said.push(text),
    latest: () => {
      const last = view.models.at(-1);
      if (!last) throw new Error("nothing was drawn");
      return last;
    },
  };
  return view;
}

export async function mount(
  options: {
    script?: Script;
    handlers?: Handlers;
    init?: Record<string, unknown>;
    store?: Record<string, unknown>;
    /** What the palette answers each pick with, in order ("" once they run out); a function sees the request. */
    picks?: Array<string | undefined | ((args: unknown) => unknown)>;
    now?: () => number;
  } = {},
) {
  const programs = fakePrograms(options.script ?? computer());
  const store: Record<string, unknown> = { ...options.store };
  const picked: unknown[] = [];
  const picks = [...(options.picks ?? [])];
  const host = createTestHost({
    pluginId: "endue.local-agents",
    handlers: {
      "store.get": ({ key }) => (key in store ? { value: store[key] } : {}),
      "store.set": ({ key, value }) => {
        store[key] = value;
        return {};
      },
      "init.get": () => ({ profile: "default", settings: { ...options.init } }),
      ...programs.handlers,
      ...options.handlers,
    },
    commands: {
      "desk.palette.pick": (args) => {
        picked.push(args);
        const next = picks.shift();
        if (typeof next === "function") return next(args);
        // The test host answers a failure as failed, not cancelled: "" is the person's cancel.
        return next ?? "";
      },
    },
  });
  programs.attach(host);
  const view = recordingView();
  let started: ReturnType<typeof startPlugin> | undefined;
  await defineUiPlugin(
    {
      mount(ctx) {
        const cancelled = (message: string) =>
          new CommandFailed("endue.local-agents.ask", "cancelled", message);
        started = startPlugin(ctx, view, {
          flushMs: 0,
          cancelled,
          plain: new Set(),
          ...(options.now ? { now: options.now } : {}),
        });
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
  if (!started) throw new Error("the plugin did not mount");
  await started.app.ready;
  await settle();
  return { host, view, programs, store, picked, settle, ...started };
}

export type Mounted = Awaited<ReturnType<typeof mount>>;
