// The PluginContext groups that are plain bridge calls (specs/bridge/v0): ctx.settings (settings.*),
// ctx.log (log.*), ctx.events (events.*), ctx.perm (perm.*) and ctx.surface.open/close (ui.surface.*).
// The core checks each call against the plugin's own grants; the scopes are added here.
import type {
  BridgeEvent,
  BridgeMethod,
  EventName,
  Grant,
  GrantDuration,
  LogEntry,
  LogLevel,
  ParamsOf,
  Permission,
  PermRequestResult,
  ResultOf,
  Setting,
  SurfacePlacement,
  UiSurfacePermission,
} from "@endue-ai/bridge";

/** The plugin's own settings, kept by the core (settings.*). Another owner's keys need a
 * `settings:read` grant and go through `ctx.bridge.call("settings.get", { owner, key, scope })`. */
export interface PluginSettings {
  /** One of the plugin's settings; undefined when it was never set. */
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  /** Every setting the plugin owns, by key. */
  list(): Promise<Setting[]>;
  /** Hear settings.changed for the plugin's own keys; the returned function stops listening. */
  onChange(listener: (setting: Setting) => void): () => void;
}

/** The plugin's log channel (log.*). */
export interface PluginLog {
  /** Add an entry to the plugin's own channel; the core stamps the time. */
  write(level: LogLevel, message: string, fields?: Record<string, unknown>): Promise<void>;
  /** The latest entries, oldest first, of one channel or of all; needs a `log:read` grant. */
  tail(options?: { channel?: string; count?: number }): Promise<LogEntry[]>;
}

/** Events about every caller, not only the plugin's own (events.*). */
export interface PluginEvents {
  /**
   * Hear the named events; needs an `events:subscribe` grant covering every name (and the data
   * permission: `settings:read`, `log:read`). Resolves with the function that unsubscribes, and
   * rejects with a `BridgeCallError` when refused.
   */
  subscribe<N extends EventName>(
    names: N[],
    listener: (event: Extract<BridgeEvent, { event: N }>) => void,
  ): Promise<() => void>;
}

/** The plugin's grants (perm.*). */
export interface PluginPerm {
  /** Ask the person; `duration` defaults to `session`. A refusal is `{ granted: false }`. */
  request(
    permission: Permission,
    reason: string,
    duration?: GrantDuration,
  ): Promise<PermRequestResult>;
  /** The plugin's grants, or only those covering `permission`. */
  query(permission?: Permission): Promise<Grant[]>;
}

export interface SurfaceOptions {
  placement?: SurfacePlacement;
  title?: string;
}

/** The bridge calls and events the groups need. */
export interface ContextBridge {
  call<M extends BridgeMethod>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>>;
  onEvent(listener: (event: BridgeEvent) => void): () => void;
}

export const SURFACE: UiSurfacePermission = { permission: "ui:surface" };

export function contextFor(bridge: ContextBridge, pluginId: string) {
  const settings: PluginSettings = {
    get: async <T>(key: string) =>
      (await bridge.call("settings.get", { key })).value as T | undefined,
    set: async (key, value) => {
      await bridge.call("settings.set", { key, value });
    },
    list: async () => (await bridge.call("settings.list", {})).settings,
    onChange: (listener) =>
      bridge.onEvent((event) => {
        if (event.event === "settings.changed" && event.data.owner === pluginId)
          listener(event.data);
      }),
  };
  const log: PluginLog = {
    write: async (level, message, fields) => {
      await bridge.call("log.write", { level, message, ...(fields ? { fields } : {}) });
    },
    tail: async (options = {}) =>
      (await bridge.call("log.tail", { ...options, scope: { permission: "log:read" } })).entries,
  };
  const events: PluginEvents = {
    subscribe: async (names, listener) => {
      const scope = { permission: "events:subscribe" as const, names: [...names] };
      const { subscriptionId } = await bridge.call("events.subscribe", { names, scope });
      const off = bridge.onEvent((event) => {
        if ((names as string[]).includes(event.event))
          listener(event as Parameters<typeof listener>[0]);
      });
      let on = true;
      return () => {
        if (!on) return;
        on = false;
        off();
        bridge.call("events.unsubscribe", { subscriptionId }).catch(() => {});
      };
    },
  };
  const perm: PluginPerm = {
    request: (permission, reason, duration) =>
      bridge.call("perm.request", { permission, reason, ...(duration ? { duration } : {}) }),
    query: async (permission) =>
      (await bridge.call("perm.query", permission ? { permission } : {})).grants,
  };
  /** ui.surface.open: resolves with the handle ctx.surface.close(handle) takes. */
  const open = async (surface: string, options: SurfaceOptions = {}) =>
    (await bridge.call("ui.surface.open", { surface, ...options, scope: SURFACE })).handle;
  return { settings, log, events, perm, open };
}
