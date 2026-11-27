/**
 * desk.customize (ADR 0398): every plugin's page takes the person's own style and script. The set
 * of the endue account signed in (this computer's while nobody is) is loaded at start, sent to each
 * plugin's windows after their init and on every change, and swapped when the account changes.
 * Safe mode and `desk.customize.enabled: false` send none, so a page the person broke opens as
 * its plugin draws it.
 */
import type { PluginInfo } from "@endue-ai/bridge";
import { MANAGE_PLUGINS } from "../plugins-launch";
import type { DeskContext, Installed } from "./context";
import { customizeCommands } from "./customize-commands";
import { type Custom, CustomStore, ownerNow } from "./customize-store";

export const ENABLED = "desk.customize.enabled";
const TYPE = "desk:custom";
/** What a page answers its outline to, in the SDK (`custom.ts`); the plugin's own never see it. */
const OUTLINE = "desk.customize.outline";
const OUTLINE_WAIT_MS = 3000;

export interface InstalledCustomize extends Installed {
  /** Resolves once the stored set is in force and sent. */
  loaded: Promise<void>;
}

export function installCustomize(ctx: DeskContext, safe = false): InstalledCustomize {
  const { bridge, hub } = ctx;
  const store = new CustomStore(bridge);
  /** The plugins whose windows hold a change now, so a swap can take theirs away. */
  const sent = new Set<string>();
  const enabled = () => !safe && hub.settings.get<boolean>(ENABLED, true) !== false;
  const send = (plugin: string, entry: Custom | undefined) => {
    const custom = enabled() && entry ? { css: entry.css, js: entry.js } : undefined;
    if (custom) sent.add(plugin);
    else if (!sent.delete(plugin)) return;
    ctx.share({ type: TYPE, custom: custom ?? {} }, plugin, custom === undefined);
  };
  const sendAll = () => {
    const entries = store.entries();
    for (const plugin of [...sent]) if (!entries.has(plugin)) send(plugin, undefined);
    for (const [plugin, entry] of entries) send(plugin, entry);
  };
  let disposed = false;
  // One swap at a time, so a quick sign-out and sign-in land in the order they came.
  let following = Promise.resolve();
  const follow = () => {
    following = following.then(async () => {
      const owner = await ownerNow(bridge);
      if (disposed || owner === store.owner()) return;
      store.use(owner);
      sendAll();
    });
  };
  const loaded = store
    .load()
    .catch(() => {})
    .then(async () => {
      if (disposed) return;
      store.use(await ownerNow(bridge));
      sendAll();
    });
  const pages = async (plugin: string) => {
    const { plugins } = await bridge.call("plugin.list", { scope: MANAGE_PLUGINS });
    const info = plugins.find((p: PluginInfo) => p.id === plugin);
    const entry = info?.manifest?.entry;
    return entry && info?.manifest?.kind === "ui" ? { entry } : undefined;
  };
  const offCommands = customizeCommands(hub.commands, {
    owner: () => store.owner(),
    entries: () => store.entries(),
    get: (plugin) => store.get(plugin),
    put: async (plugin, change) => {
      await loaded;
      const entry = store.put(plugin, change);
      send(plugin, entry);
      if (!(await store.settled())) throw new Error(`Could not keep the change to ${plugin}`);
      return entry;
    },
    page: pages,
    outline: async (plugin) => {
      if (!ctx.mounted(plugin)) return undefined;
      const late = new Promise<undefined>((done) => setTimeout(done, OUTLINE_WAIT_MS));
      const outline = await Promise.race([ctx.request(plugin, OUTLINE).catch(() => {}), late]);
      return typeof outline === "string" ? outline : undefined;
    },
    enabled,
  });
  const offEvents = bridge.onEvent((event) => {
    if (event.event === "account.changed") follow();
  });
  const offSettings = hub.settings.onChange((keys) => {
    if (keys.includes(ENABLED)) sendAll();
  });
  return {
    loaded,
    dispose: () => {
      disposed = true;
      offCommands();
      offEvents();
      offSettings();
    },
  };
}
