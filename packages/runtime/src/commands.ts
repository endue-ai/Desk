/**
 * Every command the desk can run, by id. Keys, the palette, plugins and Eris call the same ids
 * (ADR 0017). Built-in commands belong to a policy plugin and exist while it is on; plugin commands
 * are delivered to the plugin that contributed them.
 */

/** Who runs a command: a plugin by id, or the person (keys, the palette) when absent. */
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
  owner: string;
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
  caller: string | undefined;
  ok: boolean;
}

export class Commands {
  readonly #builtIn = new Map<string, CommandSpec>();
  readonly #plugins = new Map<string, CommandSpec>();
  readonly #listeners = new Set<(run: CommandRun) => void>();
  /** Plugin ids that are on; a built-in command runs only while its owner is among them. */
  #active: ReadonlySet<string> = new Set();

  /** A built-in command. Returns a function that removes it. */
  define(id: string, spec: CommandSpec): () => void {
    this.#builtIn.set(id, spec);
    return () => {
      if (this.#builtIn.get(id) === spec) this.#builtIn.delete(id);
    };
  }

  /** Replace the commands plugins contributed: `deliver` hands one to its plugin and awaits the reply. */
  setPluginCommands(
    commands: Array<{ id: string; title: string; keywords?: string[]; owner: string }>,
    deliver: (owner: string, id: string, args: unknown) => Promise<unknown>,
  ): void {
    this.#plugins.clear();
    for (const command of commands) {
      this.#plugins.set(command.id, {
        title: command.title,
        keywords: command.keywords ?? [],
        owner: command.owner,
        run: (args) => deliver(command.owner, command.id, args),
      });
    }
  }

  setActive(plugins: ReadonlySet<string>): void {
    this.#active = plugins;
  }

  has(id: string): boolean {
    return this.#find(id) !== undefined;
  }

  /** The commands available now, by id. */
  list(): CommandInfo[] {
    const ids = new Set([...this.#builtIn.keys(), ...this.#plugins.keys()]);
    return [...ids].sort().flatMap((id) => {
      const spec = this.#find(id);
      if (!spec) return [];
      return [{ id, title: spec.title, keywords: spec.keywords ?? [], owner: spec.owner }];
    });
  }

  async run(id: string, args?: unknown, from: CommandCaller = {}): Promise<unknown> {
    const spec = this.#find(id);
    if (!spec) throw new CommandError("unknown_command", `no command ${id}`);
    let ok = false;
    try {
      const result = await spec.run(args, from);
      ok = true;
      return result;
    } catch (error) {
      if (error instanceof CommandError) throw error;
      throw new CommandError("failed", `${id}: ${error instanceof Error ? error.message : error}`);
    } finally {
      for (const listener of this.#listeners) listener({ id, args, caller: from.caller, ok });
    }
  }

  /** Hear every command that ran, for history. */
  onRun(listener: (run: CommandRun) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** A plugin's own command wins over a built-in of the same id only when the built-in is off. */
  #find(id: string): CommandSpec | undefined {
    const builtIn = this.#builtIn.get(id);
    if (builtIn && (builtIn.owner === "desk" || this.#active.has(builtIn.owner))) return builtIn;
    const plugin = this.#plugins.get(id);
    if (plugin && this.#active.has(plugin.owner)) return plugin;
    return undefined;
  }
}
