import {
  BridgeCallError,
  type BridgeEvent,
  type BridgeMethod,
  type BridgeRequest,
  type BridgeResponse,
  type ParamsOf,
  type ResultOf,
} from "@endue-ai/bridge";
import {
  type CommandOutcome,
  type HostMessage,
  type ThemeState,
  type Transport,
  windowTransport,
} from "./protocol";

/** The bridge as a plugin sees it: calls are checked against the plugin's own grants. */
export interface PluginBridge {
  call<M extends BridgeMethod>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>>;
  onEvent(listener: (event: BridgeEvent) => void): () => void;
}

/** State the runtime keeps for the plugin across reloads of its surface. */
export interface PluginState {
  get<T = unknown>(): T | undefined;
  set(value: unknown): void;
}

/** The plugin's own surface. */
export interface PluginSurface {
  /** Remove the surface for the rest of this session (a finished first run, for example). */
  close(): void;
  /** Show a surface the manifest declares `hidden`; it takes the keyboard focus. */
  show(): void;
  hide(): void;
}

/** A command the desk can run now, as `ctx.commands.list()` returns it. */
export interface CommandInfo {
  id: string;
  title: string;
  keywords: string[];
  owner: string;
  /** The keys bound to it, as people read them. */
  keys: string[];
}

/** A command that failed: unknown_command, failed or cancelled. */
export class CommandFailed extends Error {
  readonly code: string;

  constructor(name: string, code: string, message: string) {
    super(`${name}: ${code}: ${message}`);
    this.name = "CommandFailed";
    this.code = code;
  }
}

/**
 * Commands, both ways (ADR 0017): `on` answers the commands this plugin contributes (what the
 * handler returns is the answer), `run` runs any command the desk has, as keys and the palette do.
 */
export interface PluginCommands {
  on(name: string, handler: (args: unknown) => unknown): () => void;
  run<T = unknown>(name: string, args?: unknown): Promise<T>;
  list(): Promise<CommandInfo[]>;
}

/** The desk's theme, also applied to this frame as --desk-* custom properties. */
export interface PluginTheme {
  get(): ThemeState | undefined;
  on(listener: (theme: ThemeState) => void): () => void;
}

export interface PluginContext {
  pluginId: string;
  bridge: PluginBridge;
  state: PluginState;
  surface: PluginSurface;
  commands: PluginCommands;
  theme: PluginTheme;
}

export interface UiPlugin {
  mount(ctx: PluginContext): void | Promise<void>;
}

type Pending = {
  method: BridgeMethod;
  resolve: (value: unknown) => void;
  reject: (e: unknown) => void;
};

/** Called by defineUiPlugin once `mount` has finished, so commands that came early get answered. */
const mountedHooks = new WeakMap<PluginContext, () => void>();
const usedByDefine = new WeakSet<PluginContext>();

/**
 * Say hello to the host and resolve once it answers with the plugin id and saved state. Commands
 * that arrive before their handler is registered wait until the plugin has mounted.
 */
export function connect(transport: Transport = windowTransport()): Promise<PluginContext> {
  return new Promise((resolve) => {
    let markMounted: () => void = () => {};
    const mounted = new Promise<void>((done) => {
      markMounted = done;
    });
    const pending = new Map<number, Pending>();
    const listeners = new Set<(event: BridgeEvent) => void>();
    const commands = new Map<string, Set<(args: unknown) => unknown>>();
    const runs = new Map<
      number,
      { name: string; resolve(v: unknown): void; reject(e: unknown): void }
    >();
    const themeListeners = new Set<(theme: ThemeState) => void>();
    let queue: BridgeRequest[] = [];
    let nextId = 1;
    let nextRun = 1;
    let state: unknown;
    let theme: ThemeState | undefined;

    const answer = async (name: string, call: number | undefined, args: unknown) => {
      if (!commands.get(name)?.size) await mounted;
      const handlers = [...(commands.get(name) ?? [])];
      let outcome: CommandOutcome;
      try {
        if (handlers.length === 0) throw new CommandFailed(name, "unknown_command", "no handler");
        const results = await Promise.all(handlers.map((handler) => handler(args)));
        outcome = { call: call ?? 0, ok: true, result: results[0] };
      } catch (error) {
        const code = error instanceof CommandFailed ? error.code : "failed";
        const message = error instanceof Error ? error.message : String(error);
        outcome = { call: call ?? 0, ok: false, error: { code, message } };
      }
      if (call !== undefined) transport.send({ type: "desk:reply", ...outcome });
    };

    const flush = () => {
      const calls = queue;
      queue = [];
      if (calls.length > 0) transport.send({ type: "desk:calls", calls });
    };
    const settle = (id: number, response: BridgeResponse) => {
      const call = pending.get(id);
      if (!call) return;
      pending.delete(id);
      if (response.ok) call.resolve(response.result);
      else call.reject(new BridgeCallError(call.method, response.error));
    };

    const ctxFor = (pluginId: string): PluginContext => ({
      pluginId,
      bridge: {
        call: <M extends BridgeMethod>(method: M, params: ParamsOf<M>) =>
          new Promise<ResultOf<M>>((res, reject) => {
            const id = nextId++;
            pending.set(id, { method, resolve: res as (v: unknown) => void, reject });
            // Calls made in the same tick leave together in one postMessage.
            if (queue.length === 0) queueMicrotask(flush);
            queue.push({ id, method, params } as BridgeRequest);
          }),
        onEvent: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      state: {
        get: <T>() => state as T | undefined,
        set: (value) => {
          state = value;
          transport.send({ type: "desk:state", state: value });
        },
      },
      surface: {
        close: () => transport.send({ type: "desk:close" }),
        show: () => transport.send({ type: "desk:visible", visible: true }),
        hide: () => transport.send({ type: "desk:visible", visible: false }),
      },
      commands: {
        on: (name, handler) => {
          const handlers = commands.get(name) ?? new Set();
          handlers.add(handler);
          commands.set(name, handlers);
          return () => handlers.delete(handler);
        },
        run: <T>(name: string, args?: unknown) =>
          new Promise<T>((res, reject) => {
            const call = nextRun++;
            runs.set(call, { name, resolve: res as (v: unknown) => void, reject });
            transport.send({ type: "desk:run", call, name, args });
          }),
        list: () => ctx.commands.run<CommandInfo[]>("desk.commands.list"),
      },
      theme: {
        get: () => theme,
        on: (listener) => {
          themeListeners.add(listener);
          return () => themeListeners.delete(listener);
        },
      },
    });
    let ctx: PluginContext;

    transport.listen((message: HostMessage) => {
      switch (message.type) {
        case "desk:init":
          state = message.state;
          ctx = ctxFor(message.pluginId);
          mountedHooks.set(ctx, markMounted);
          // Without defineUiPlugin, handlers registered right after connect() count as mounted.
          setTimeout(() => {
            if (!usedByDefine.has(ctx)) markMounted();
          }, 0);
          resolve(ctx);
          break;
        case "desk:results":
          for (const { id, response } of message.results) settle(id, response);
          break;
        case "desk:event":
          for (const listener of listeners) listener(message.event);
          break;
        case "desk:command":
          void answer(message.name, message.call, message.args);
          break;
        case "desk:ran": {
          const run = runs.get(message.call);
          if (!run) break;
          runs.delete(message.call);
          if (message.ok) run.resolve(message.result);
          else {
            const { code = "failed", message: text = "" } = message.error ?? {};
            run.reject(new CommandFailed(run.name, code, text));
          }
          break;
        }
        case "desk:theme":
          theme = message.theme;
          transport.theme?.(message.theme);
          for (const listener of themeListeners) listener(message.theme);
          break;
      }
    });
    // Chords pressed inside the frame still reach the desk's keymap.
    transport.keys?.((key) => transport.send({ type: "desk:key", key }));
    transport.send({ type: "desk:hello" });
  });
}

/** Connect and mount. Resolves with the context once `mount` has finished. */
export async function defineUiPlugin(
  plugin: UiPlugin,
  transport: Transport = windowTransport(),
): Promise<PluginContext> {
  const ctx = await connect(transport);
  usedByDefine.add(ctx);
  try {
    await plugin.mount(ctx);
  } finally {
    mountedHooks.get(ctx)?.();
  }
  return ctx;
}
