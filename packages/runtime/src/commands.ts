/**
 * The desk's side of the command registry (ADR 0017). The registry is the core's (bridge cmd.*):
 * the runtime registers its built-in commands there as `desk` while the policy plugin that owns each
 * is on, answers their cmd.invoked events, and runs every command, its own or a plugin's, with
 * cmd.invoke. Keys and the palette read a mirror of the registry kept current from cmd.changed.
 */
import type { BridgeClient, BridgeEvent, CmdAnsweredData } from "@endue-ai/bridge";

/** Who runs a command: a plugin by id, or the person (keys, the palette's runs for them) when absent. */
export interface CommandCaller {
  caller?: string;
  /** The core verified the named file came from a person's choice. */
  fileOpenGranted?: boolean;
}

export type CommandHandler = (args: unknown, from: CommandCaller) => unknown;

export interface CommandSpec {
  /** Its title, or a function read at each registration: a title in the desk's language (ADR 0250). */
  title: string | (() => string);
  keywords?: string[];
  /** The policy plugin the command belongs to; `desk` is the runtime itself and is always on. */
  owner: string;
  run: CommandHandler;
  /** What agents read of the command when it is one of their tools (ADR 0088). */
  agent?: AgentSpec;
  description?: string;
  argsSchema?: Record<string, unknown>;
  resultSchema?: Record<string, unknown>;
  /** Marks an irreversible command independently of whether it is offered to agents. */
  irreversible?: boolean;
  /**
   * The built-in that undoes this one (ADR 0077): an ok answer lands on the desk's undo stack, and
   * cmd.undo runs it with `{ args, result }`.
   */
  undo?: string;
}

/** A built-in command as agents' tool: what it does, its args and answer, and whether it only reads. */
export interface AgentSpec {
  description: string;
  args?: Record<string, unknown>;
  result?: Record<string, unknown>;
  readOnly?: boolean;
  irreversible?: boolean;
}

export interface CommandInfo {
  id: string;
  title: string;
  keywords: string[];
  /** The caller that provides it: `desk` for built-ins, else a plugin id. */
  provider: string;
  /** It answers data and changes nothing the person keeps. */
  readOnly?: boolean;
  /** An agent's call waits for approval. */
  irreversible?: boolean;
}

export type CommandErrorCode = "unknown_command" | "failed" | "cancelled";

export class CommandError extends Error {
  readonly code: CommandErrorCode;

  constructor(code: CommandErrorCode, message: string) {
    super(message);
    this.name = "CommandError";
    this.code = code;
  }
}

export interface CommandRun {
  id: string;
  args: unknown;
  ok: boolean;
}

/** A built-in the core asked this desk to run: which, with what, and who asked. */
export interface AskedRun {
  id: string;
  args: unknown;
  caller: string;
}

/** Told of an asked run as it starts; what it returns hears the command's answer. */
export type RunWatcher = (run: AskedRun) => ((result: unknown) => void) | undefined;

const DESK = "desk";
const ALL = { permission: "cmd:invoke" as const, ids: ["*"] };

type Waiter = { resolve(data: CmdAnsweredData): void };

export class Commands {
  readonly #bridge: BridgeClient;
  readonly #builtIn = new Map<string, CommandSpec>();
  /** Registration payloads the core holds for the desk, by id. */
  readonly #registered = new Map<string, string>();
  #active: ReadonlySet<string> = new Set([DESK]);
  /** The core's registry as last listed. */
  #known = new Map<string, CommandInfo>();
  readonly #waiting = new Map<string, Waiter>();
  /** Answers that arrived before cmd.invoke's own answer named their invocation. */
  readonly #early = new Map<string, CmdAnsweredData>();
  readonly #forwarding = new Map<string, number>();
  readonly #listeners = new Set<(run: CommandRun) => void>();
  readonly #watchers = new Set<RunWatcher>();
  readonly #changes = new Set<() => void>();
  #chain: Promise<void> = Promise.resolve();
  #queued = false;
  readonly #off: () => void;

  constructor(bridge: BridgeClient) {
    this.#bridge = bridge;
    this.#off = bridge.onEvent((event) => this.#onEvent(event));
  }

  /** A built-in command, provided by the desk while `owner` is on. Returns a function that removes it. */
  define(id: string, spec: CommandSpec): () => void {
    this.#builtIn.set(id, spec);
    this.#schedule();
    return () => {
      if (this.#builtIn.get(id) !== spec) return;
      this.#builtIn.delete(id);
      this.#schedule();
    };
  }

  /** The plugins that are on: their built-in commands are registered, the others unregistered. */
  setActive(plugins: Iterable<string>): void {
    this.#active = new Set([DESK, ...plugins]);
    this.#schedule();
  }

  /** Register again each built-in whose title is now another (the desk's language changed). */
  retitle(): void {
    this.#schedule();
  }

  has(id: string): boolean {
    return this.#known.has(id);
  }

  /** Whether the registered command `id` only reads (`readOnly`): answers data, changes nothing. */
  readOnly(id: string): boolean {
    return this.#known.get(id)?.readOnly === true;
  }

  /**
   * Watch the built-ins the core asks this desk to run, whoever asked (the person, a plugin, an
   * agent as `agent:<id>`): Eris's errands read which window a command of hers names (ADR 0271).
   */
  watchRuns(watcher: RunWatcher): () => void {
    this.#watchers.add(watcher);
    return () => this.#watchers.delete(watcher);
  }

  /** Every registered command, by id, as the core listed it last. */
  list(): CommandInfo[] {
    return [...this.#known.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  providerOf(id: string): string | undefined {
    return this.#known.get(id)?.provider;
  }

  /** Resolves once the registry and the mirror have caught up with every change asked for. */
  async settled(): Promise<void> {
    let chain: Promise<void>;
    do {
      chain = this.#chain;
      await chain;
    } while (chain !== this.#chain || this.#queued);
  }

  /** Run a command and await its answer. An alias can forward its authenticated agent caller. */
  async run(id: string, args?: unknown, caller?: string): Promise<unknown> {
    let ok = false;
    try {
      const answer = await this.#invoke(id, args, caller);
      if (!answer.ok) {
        const code = answer.error?.code === "cancelled" ? "cancelled" : "failed";
        throw new CommandError(code, `${id}: ${answer.error?.message ?? "failed"}`);
      }
      ok = true;
      return answer.result;
    } finally {
      for (const listener of this.#listeners) listener({ id, args, ok });
    }
  }

  /** Hear every command the desk ran, for history. */
  onRun(listener: (run: CommandRun) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Registry changes, including plugins enabled or disabled while settings is open. */
  onChange(listener: () => void): () => void {
    this.#changes.add(listener);
    return () => this.#changes.delete(listener);
  }

  dispose(): void {
    this.#off();
  }

  async stack(method: "cmd.undo" | "cmd.redo") {
    const result = await this.#bridge.call(method, { scope: ALL });
    if (result.invocationId) {
      const answer = await this.#answerFor(result.invocationId);
      if (!answer.ok) throw new CommandError("failed", answer.error?.message ?? "Undo failed");
    }
    return result.undone;
  }

  async #invoke(id: string, args: unknown, caller?: string): Promise<CmdAnsweredData> {
    const objectArgs =
      typeof args === "object" && args !== null && !Array.isArray(args)
        ? { args: args as Record<string, unknown> }
        : {};
    const key = caller ? `${caller}/${id}` : "";
    if (key) this.#forwarding.set(key, (this.#forwarding.get(key) ?? 0) + 1);
    try {
      const { invocationId } = await this.#bridge.call(
        "cmd.invoke",
        { id, ...objectArgs, scope: { permission: "cmd:invoke", ids: [id] } },
        caller ? { caller } : {},
      );
      return this.#answerFor(invocationId);
    } catch (error) {
      const code = (error as { code?: string }).code;
      throw new CommandError(
        code === "not_found" || code === "unsupported" ? "unknown_command" : "failed",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      if (key) {
        const pending = (this.#forwarding.get(key) ?? 1) - 1;
        if (pending > 0) this.#forwarding.set(key, pending);
        else this.#forwarding.delete(key);
      }
    }
  }

  #answerFor(invocationId: string): Promise<CmdAnsweredData> {
    const early = this.#early.get(invocationId);
    if (early) {
      this.#early.delete(invocationId);
      return Promise.resolve(early);
    }
    return new Promise((resolve) => this.#waiting.set(invocationId, { resolve }));
  }

  #onEvent(event: BridgeEvent): void {
    switch (event.event) {
      case "cmd.changed":
        this.#schedule();
        break;
      case "cmd.invoked": {
        const { id, invocationId, args, caller, fileOpenGranted } = event.data;
        const spec = this.#builtIn.get(id);
        if (spec && this.#registered.has(id)) {
          const ends = [...this.#watchers].map((watch) => watch({ id, args, caller }));
          const heard = (result: unknown) => {
            for (const end of ends) end?.(result);
          };
          const from =
            caller === DESK ? {} : { caller, ...(fileOpenGranted ? { fileOpenGranted } : {}) };
          void this.#answer(invocationId, spec, args, from, heard);
        }
        break;
      }
      case "cmd.answered": {
        const waiter = this.#waiting.get(event.data.invocationId);
        if (waiter) {
          this.#waiting.delete(event.data.invocationId);
          waiter.resolve(event.data);
        } else if (
          event.data.caller === DESK ||
          this.#forwarding.has(`${event.data.caller}/${event.data.id}`)
        ) {
          this.#early.set(event.data.invocationId, event.data);
        }
        break;
      }
    }
  }

  async #answer(
    invocationId: string,
    spec: CommandSpec,
    args: unknown,
    from: CommandCaller,
    heard: (result: unknown) => void,
  ) {
    try {
      const result = await spec.run(args ?? {}, from);
      heard(result);
      await this.#bridge.call("cmd.answer", {
        invocationId,
        ...(result === undefined ? {} : { result }),
      });
    } catch (error) {
      const code =
        error instanceof CommandError && error.code === "cancelled" ? "cancelled" : "failed";
      const message = error instanceof Error ? error.message : String(error);
      await this.#bridge
        .call("cmd.answer", { invocationId, error: { code, message } })
        .catch(() => {});
    }
  }

  /** Queue one pass of register/unregister and re-listing; passes run one after another. */
  #schedule(): void {
    if (this.#queued) return;
    this.#queued = true;
    this.#chain = this.#chain.then(async () => {
      this.#queued = false;
      await this.#sync();
    });
  }

  /**
   * One pass: the calls of each step go out together, not one after another. At start the listed
   * policy plugins bring dozens of built-ins while the plugin frames load, and one call waiting for
   * the answer of the one before took the core's round trip that many times.
   */
  async #sync(): Promise<void> {
    const gone = [...this.#registered.keys()].filter((id) => {
      const spec = this.#builtIn.get(id);
      return !(spec && this.#active.has(spec.owner));
    });
    for (const id of gone) this.#registered.delete(id);
    await Promise.all(
      gone.map((id) => this.#bridge.call("cmd.unregister", { id }).catch(() => {})),
    );
    const due = [...this.#builtIn].filter(([, spec]) => this.#active.has(spec.owner));
    await Promise.all(
      due.map(async ([id, spec]) => {
        const agent = spec.agent;
        const description = agent?.description ?? spec.description;
        const argsSchema = agent?.args ?? spec.argsSchema;
        const resultSchema = agent?.result ?? spec.resultSchema;
        const params = {
          id,
          title: titleOf(spec),
          ...(spec.keywords ? { keywords: spec.keywords } : {}),
          ...(agent ? { agent: true } : {}),
          ...(description ? { description } : {}),
          ...(argsSchema ? { argsSchema } : {}),
          ...(resultSchema ? { resultSchema } : {}),
          ...(agent?.readOnly ? { readOnly: true } : {}),
          ...(spec.irreversible || agent?.irreversible ? { irreversible: true } : {}),
          ...(spec.undo ? { undo: spec.undo } : {}),
        };
        const signature = JSON.stringify(params);
        if (this.#registered.get(id) === signature) return;
        // A core without cmd.* (an older one, a bare stub) leaves the command unregistered.
        const ok = await this.#bridge.call("cmd.register", params).then(
          () => true,
          () => false,
        );
        if (ok) this.#registered.set(id, signature);
      }),
    );
    const listed = await this.#bridge.call("cmd.list", { scope: ALL }).catch(() => undefined);
    if (!listed) return;
    this.#known = new Map(
      listed.commands.map((c) => [
        c.id,
        {
          id: c.id,
          title: c.title,
          keywords: c.keywords ?? [],
          provider: c.provider,
          ...(c.readOnly ? { readOnly: true } : {}),
          ...(c.irreversible ? { irreversible: true } : {}),
        },
      ]),
    );
    for (const listener of this.#changes) listener();
  }
}

const titleOf = (spec: CommandSpec): string =>
  typeof spec.title === "function" ? spec.title() : spec.title;
