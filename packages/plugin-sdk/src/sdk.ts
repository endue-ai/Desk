import {
  BridgeCallError,
  type BridgeEvent,
  type BridgeMethod,
  type BridgeRequest,
  type BridgeResponse,
  type ParamsOf,
  type ResultOf,
} from "@endue-ai/bridge";
import { type HostMessage, type Transport, windowTransport } from "./protocol";

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
}

/** Commands the runtime sends this plugin, by name. */
export interface PluginCommands {
  on(name: string, handler: (args: unknown) => void): () => void;
}

export interface PluginContext {
  pluginId: string;
  bridge: PluginBridge;
  state: PluginState;
  surface: PluginSurface;
  commands: PluginCommands;
}

export interface UiPlugin {
  mount(ctx: PluginContext): void | Promise<void>;
}

type Pending = {
  method: BridgeMethod;
  resolve: (value: unknown) => void;
  reject: (e: unknown) => void;
};

/** Say hello to the host and resolve once it answers with the plugin id and saved state. */
export function connect(transport: Transport = windowTransport()): Promise<PluginContext> {
  return new Promise((resolve) => {
    const pending = new Map<number, Pending>();
    const listeners = new Set<(event: BridgeEvent) => void>();
    const commands = new Map<string, Set<(args: unknown) => void>>();
    let queue: BridgeRequest[] = [];
    let nextId = 1;
    let state: unknown;

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
      },
      commands: {
        on: (name, handler) => {
          const handlers = commands.get(name) ?? new Set();
          handlers.add(handler);
          commands.set(name, handlers);
          return () => handlers.delete(handler);
        },
      },
    });

    transport.listen((message: HostMessage) => {
      switch (message.type) {
        case "desk:init":
          state = message.state;
          resolve(ctxFor(message.pluginId));
          break;
        case "desk:results":
          for (const { id, response } of message.results) settle(id, response);
          break;
        case "desk:event":
          for (const listener of listeners) listener(message.event);
          break;
        case "desk:command":
          for (const handler of commands.get(message.name) ?? []) handler(message.args);
          break;
      }
    });
    transport.send({ type: "desk:hello" });
  });
}

/** Connect and mount. Resolves with the context once `mount` has finished. */
export async function defineUiPlugin(
  plugin: UiPlugin,
  transport: Transport = windowTransport(),
): Promise<PluginContext> {
  const ctx = await connect(transport);
  await plugin.mount(ctx);
  return ctx;
}
