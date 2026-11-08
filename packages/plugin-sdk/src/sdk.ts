import {
  BridgeCallError,
  type BridgeEvent,
  type BridgeMethod,
  type BridgeRequest,
  type BridgeResponse,
  type ParamsOf,
  type ResultOf,
} from "@endue-ai/bridge";
import { commandsFor, type PluginCommands } from "./commands";
import {
  contextFor,
  type PluginEvents,
  type PluginLog,
  type PluginPerm,
  type PluginSettings,
  SURFACE,
  type SurfaceOptions,
} from "./context";
import { dataFor, type PluginData, type PluginViews } from "./data";
import { dndFor } from "./dnd";
import type { PluginDnd } from "./dnd/types";
import { type HostMessage, type ThemeState, type Transport, windowTransport } from "./protocol";
import { frameStart } from "./ready";
import { type PluginSearch, searchFor } from "./search";
import { SURFACE_STATE, stateAnswer } from "./surface-state";
import { type PluginUniversal, universalFor } from "./universal";

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

/** The plugin's own surface, and the other surfaces its manifest declares (ui.surface.*). */
export interface PluginSurface {
  /** Open a surface the manifest declares (needs `ui:surface`); resolves with its handle. */
  open(surface: string, options?: SurfaceOptions): Promise<string>;
  /**
   * Close the surface `open` returned; without a handle, remove this frame's own surface for the
   * rest of this session (a finished first run, for example).
   */
  close(handle?: string): Promise<void>;
  /** Show a surface the manifest declares `hidden`; it takes the keyboard focus. */
  show(): void;
  hide(): void;
  /**
   * What to keep when the desk unloads this surface while nobody sees it (ui.surface.state, ADR
   * 0070): JSON up to 64 KiB, handed back as `restored` when it shows again. Without a provider the
   * surface comes back cold. Returns a function that removes the provider.
   */
  onUnload(provider: () => unknown): () => void;
  /** What `onUnload` kept before the desk last unloaded this surface; undefined on a cold start. */
  readonly restored: unknown;
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
  search: PluginSearch;
  theme: PluginTheme;
  settings: PluginSettings;
  log: PluginLog;
  events: PluginEvents;
  perm: PluginPerm;
  /** The desk's item index (data.*), under the plugin's data:read grants. */
  data: PluginData;
  /** The person's views (view.*), under view:manage. */
  views: PluginViews;
  /** Universal views: load any source of the universal data format and draw it (ADR 0087). */
  universal: PluginUniversal;
  /** Drag and drop between plugins: desk data out of this frame, drops into it (ADR 0119). */
  dnd: PluginDnd;
}

export interface UiPlugin {
  mount(ctx: PluginContext): void | Promise<void>;
}

type Pending = {
  method: BridgeMethod;
  resolve: (value: unknown) => void;
  reject: (e: unknown) => void;
};

/** This frame's start, watched from the moment the SDK loads (ADR 0061). */
const start = frameStart();

/** Tell the desk how the start went: through the frame's watch, or the transport outside a frame. */
function report(transport: Transport, failure?: unknown): void {
  const message = failure instanceof Error ? failure.message : String(failure);
  if (start) {
    if (failure === undefined) start.ready();
    else start.failed(message);
  } else if (failure === undefined) transport.send({ type: "desk:ready" });
  else transport.send({ type: "desk:failed", message });
}

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
    const themeListeners = new Set<(theme: ThemeState) => void>();
    let queue: BridgeRequest[] = [];
    let nextId = 1;
    let state: unknown;
    let theme: ThemeState | undefined;

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

    const bridge: PluginBridge = {
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
    };
    const commands = commandsFor(bridge as Parameters<typeof commandsFor>[0], mounted);
    const dnd = dndFor(transport);

    const ctxFor = (pluginId: string, restored: unknown): PluginContext => {
      const { open, ...groups } = contextFor(bridge, pluginId);
      const { data, views } = dataFor(bridge);
      const universal = universalFor({
        pluginId,
        call: (method, params) => bridge.call(method, params),
        run: (id, args) => commands.api.run(id, args),
        query: (query) => data.query(query),
        subscribe: (query, listener) => data.subscribe(query, () => listener()),
      });
      return {
        pluginId,
        bridge,
        state: {
          get: <T>() => state as T | undefined,
          set: (value) => {
            state = value;
            transport.send({ type: "desk:state", state: value });
          },
        },
        surface: {
          open,
          close: async (handle) => {
            if (handle === undefined) transport.send({ type: "desk:close" });
            else await bridge.call("ui.surface.close", { handle, scope: SURFACE });
          },
          show: () => transport.send({ type: "desk:visible", visible: true }),
          hide: () => transport.send({ type: "desk:visible", visible: false }),
          onUnload: (provider) => commands.api.on(SURFACE_STATE, stateAnswer(provider)),
          restored,
        },
        commands: commands.api,
        search: searchFor(bridge),
        data,
        views,
        universal,
        dnd: dnd.api,
        theme: {
          get: () => theme,
          on: (listener) => {
            themeListeners.add(listener);
            return () => themeListeners.delete(listener);
          },
        },
        ...groups,
      };
    };
    let ctx: PluginContext;

    transport.listen((message: HostMessage) => {
      if (dnd.handle(message)) return;
      switch (message.type) {
        case "desk:init":
          state = message.state;
          ctx = ctxFor(message.pluginId, message.restored);
          mountedHooks.set(ctx, markMounted);
          // Without defineUiPlugin, handlers registered right after connect() count as mounted.
          setTimeout(() => {
            if (usedByDefine.has(ctx)) return;
            markMounted();
            report(transport);
          }, 0);
          resolve(ctx);
          break;
        case "desk:results":
          for (const { id, response } of message.results) settle(id, response);
          break;
        case "desk:event":
          commands.event(message.event);
          for (const listener of listeners) listener(message.event);
          break;
        case "desk:command": {
          const { name, args, call } = message;
          void commands.request(name, args).then((outcome) => {
            if (call !== undefined) transport.send({ type: "desk:reply", call, ...outcome });
          });
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
  } catch (failure) {
    report(transport, failure);
    throw failure;
  } finally {
    mountedHooks.get(ctx)?.();
  }
  report(transport);
  return ctx;
}
