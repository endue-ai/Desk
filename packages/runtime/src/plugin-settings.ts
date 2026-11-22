/**
 * A plugin's setting the person sets in Settings › Plugins reaches the plugin (#570). The value
 * lives where ADR 0127 put it, in the runtime's session layer and the preferences record; the
 * bridge the plugin host relays through lays it over what the core answers a plugin's
 * `settings.get` and `settings.list`, after the core's own checks, and a change or a Reset sends
 * `settings.changed` to the owner's windows, as the core's `settings.set` does. Only the keys the
 * preferences keep are the person's; other session values of plugin keys stay the runtime's.
 */
import type {
  BridgeClient,
  BridgeEvent,
  BridgeRequest,
  BridgeResponse,
  Setting,
} from "@endue-ai/bridge";
import type { PolicyHub } from "./hub";
import type { Settings } from "./settings";

export interface PersonalSettings {
  settings: Pick<Settings, "layer" | "get" | "onEdit">;
  /** The plugins' keys the preferences keep, by full name (`endue.calendar.view`). */
  pluginKeys(): string[];
  /** The plugin that declares a full key. */
  owner(key: string): string | undefined;
}

type Listener = (event: BridgeEvent) => void;

/** `bridge` for the plugin host, with the person's plugin settings laid over the core's. */
export function pluginSettings(bridge: BridgeClient, personal: PersonalSettings): BridgeClient {
  const listeners = new Set<Listener>();
  const emit = (setting: Setting) => {
    const event = { event: "settings.changed", data: setting, to: [setting.owner] } as BridgeEvent;
    for (const listener of [...listeners]) listener(event);
  };
  /** The person's value of a full key, if they set one. */
  const personOf = (full: string): { value: unknown } | undefined => {
    const session = personal.settings.layer("session");
    if (!personal.pluginKeys().includes(full) || !Object.hasOwn(session, full)) return undefined;
    return { value: session[full] };
  };
  const named = (owner: string, key: string) => personOf(`${owner}.${key}`);

  // What each kept key was last told as, so an edit sends only what moved.
  const told = new Map<string, string>();
  personal.settings.onEdit(() => {
    for (const full of new Set([...personal.pluginKeys(), ...told.keys()])) {
      const owner = personal.owner(full);
      if (!owner) continue;
      const key = full.slice(owner.length + 1);
      const now = personOf(full);
      const text = now === undefined ? undefined : JSON.stringify(now.value);
      if (text === told.get(full)) continue;
      if (now !== undefined && text !== undefined) {
        told.set(full, text);
        emit({ owner, key, value: now.value });
        continue;
      }
      told.delete(full);
      // A Reset: the plugin hears the value it reads now, the core's, else its declared default.
      void bridge.call("settings.get", { key }, { caller: owner }).then(
        ({ value }) => {
          const shown = value === undefined ? personal.settings.get(full) : value;
          if (shown !== undefined && personOf(full) === undefined)
            emit({ owner, key, value: shown });
        },
        () => {},
      );
    }
  });

  const forward = async (request: BridgeRequest, caller: string): Promise<BridgeResponse> => {
    const response = await bridge.forward(request, caller);
    if (!response.ok) return response;
    if (request.method === "settings.get") {
      const mine = named(request.params.owner ?? caller, request.params.key);
      const result = response.result as Record<string, unknown>;
      return mine ? ({ ...response, result: { ...result, ...mine } } as BridgeResponse) : response;
    }
    if (request.method === "settings.list") {
      const { settings } = response.result as { settings: Setting[] };
      const laid = settings.map((s) => ({ ...s, ...named(s.owner, s.key) }));
      return { ...response, result: { settings: laid } } as BridgeResponse;
    }
    return response;
  };
  const onEvent = (listener: Listener) => {
    listeners.add(listener);
    const off = bridge.onEvent(listener);
    return () => {
      listeners.delete(listener);
      off();
    };
  };
  // The same client in every other way: its own calls, and whatever else the desk gave it.
  return new Proxy(bridge, {
    get(target, prop) {
      if (prop === "forward") return forward;
      if (prop === "onEvent") return onEvent;
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** What the runtime's hub and preferences know of the person's plugin settings. */
export function personalOf(
  hub: Pick<PolicyHub, "settings" | "policy">,
  preferences: { pluginKeys(): string[] },
): PersonalSettings {
  return {
    settings: hub.settings,
    pluginKeys: () => preferences.pluginKeys(),
    owner: (key) => hub.policy.settings[key]?.owner,
  };
}
