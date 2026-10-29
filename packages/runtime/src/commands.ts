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
}

export type CommandHandler = (args: unknown, from: CommandCaller) => unknown;

export interface CommandSpec {
  title: string;
  keywords?: string[];
  /** The policy plugin the command belongs to; `desk` is the runtime itself and is always on. */
  owner: string;
  run: CommandHandler;
}

export interface CommandInfo {
  id: string;
  title: string;
  keywords: string[];
  /** The caller that provides it: `desk` for built-ins, else a plugin id. */
  provider: string;
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

const DESK = "desk";
const ALL = { permission: "cmd:invoke" as const, ids: ["*"] };

type Waiter = { resolve(data: CmdAnsweredData): void };

export class Commands {
  readonly #bridge: BridgeClient;
  readonly #builtIn = new Map<string, CommandSpec>();
  /** Built-ins the core holds for the desk now. */
  readonly #registered = new Set<string>();
  #active: ReadonlySet<string> = new Set([DESK]);
  /** The core's registry as last listed. */
  #known = new Map<string, CommandInfo>();
  readonly #waiting = new Map<string, Waiter>();
  /** Answers that arrived before cmd.invoke's own answer named their invocation. */
  readonly #early = new Map<string, CmdAnsweredData>();
  readonly #listeners = new Set<(run: CommandRun) => void>();
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

  has(id: string): boolean {
    return this.#known.has(id);
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

  /** Run a command as the desk, whoever provides it, and resolve with its answer. */
  async run(id: string, args?: unknown): Promise<unknown> {
    let ok = false;
    try {
      const answer = await this.#invoke(id, args);
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

  dispose(): void {
    this.#off();
  }

  async #invoke(id: string, args: unknown): Promise<CmdAnsweredData> {
    const objectArgs =
      typeof args === "object" && args !== null && !Array.isArray(args)
        ? { args: args as Record<string, unknown> }
        : {};
    let invocationId: string;
    try {
      ({ invocationId } = await this.#bridge.call("cmd.invoke", {
        id,
        ...objectArgs,
        scope: { permission: "cmd:invoke", ids: [id] },
      }));
    } catch (error) {
      const code = (error as { code?: string }).code;
      throw new CommandError(
        code === "not_found" || code === "unsupported" ? "unknown_command" : "failed",
        error instanceof Error ? error.message : String(error),
      );
    }
    const early = this.#early.get(invocationId);
    if (early) {
      this.#early.delete(invocationId);
      return early;
    }
    return new Promise((resolve) => this.#waiting.set(invocationId, { resolve }));
  }

  #onEvent(event: BridgeEvent): void {
    switch (event.event) {
      case "cmd.changed":
        this.#schedule();
        break;
      case "cmd.invoked": {
        const { id, invocationId, args, caller } = event.data;
        const spec = this.#builtIn.get(id);
        if (spec && this.#registered.has(id)) void this.#answer(invocationId, spec, args, caller);
        break;
      }
      case "cmd.answered": {
        if (event.data.caller !== DESK) break;
        const waiter = this.#waiting.get(event.data.invocationId);
        if (waiter) {
          this.#waiting.delete(event.data.invocationId);
          waiter.resolve(event.data);
        } else {
          this.#early.set(event.data.invocationId, event.data);
        }
        break;
      }
    }
  }

  async #answer(invocationId: string, spec: CommandSpec, args: unknown, caller: string) {
    try {
      const result = await spec.run(args ?? {}, caller === DESK ? {} : { caller });
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

  async #sync(): Promise<void> {
    for (const id of [...this.#registered]) {
      const spec = this.#builtIn.get(id);
      if (spec && this.#active.has(spec.owner)) continue;
      this.#registered.delete(id);
      await this.#bridge.call("cmd.unregister", { id }).catch(() => {});
    }
    for (const [id, spec] of this.#builtIn) {
      if (this.#registered.has(id) || !this.#active.has(spec.owner)) continue;
      const params = {
        id,
        title: spec.title,
        ...(spec.keywords ? { keywords: spec.keywords } : {}),
      };
      // A core without cmd.* (an older one, a bare stub) leaves the command unregistered.
      const ok = await this.#bridge.call("cmd.register", params).then(
        () => true,
        () => false,
      );
      if (ok) this.#registered.add(id);
    }
    const listed = await this.#bridge.call("cmd.list", { scope: ALL }).catch(() => undefined);
    if (!listed) return;
    this.#known = new Map(
      listed.commands.map((c) => [
        c.id,
        { id: c.id, title: c.title, keywords: c.keywords ?? [], provider: c.provider },
      ]),
    );
  }
}
