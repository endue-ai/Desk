/**
 * The desk shell in two layers. The system layer holds the desk's own controls at fixed places
 * (profile switcher, desktops, agent bar); the mode layer holds what a profile lays out (Eris, the
 * rail, the bottom edge, surfaces) over the runtime (plugin surfaces, the status line). The runtime
 * is the one desk under both: its commands, keymap, settings, theme, profiles and session are the
 * shell's. The centre stays empty. Tab order follows the DOM:
 * profiles → desktops → agent bar → plugin surfaces → Eris → rail → bottom → surfaces.
 */
import type { BridgeClient } from "@endue-ai/bridge";
import type { ShellBridge } from "../bridge/types";
import { type Clock, realClock } from "../clock";
import { type ErisHandle, mountEris } from "../eris/Eris";
import { detectPlatform, type Platform } from "../input";
import type { PluginHostOptions } from "../plugins";
import { createRuntime, type Runtime } from "../runtime";
import { pluginWindows } from "../surface/host";
import { mountSurfaces } from "../surface/Surface";
import { loadDirectory } from "../system/agents";
import { mountSystemLayer } from "../system/layer";
import { layoutOf } from "./actions";
import { mountBottom } from "./Bottom";
import { defineCommands, dismiss } from "./commands";
import type { ShellCtx } from "./context";
import { type Lang, t } from "./copy";
import { h, listen } from "./dom";
import { keepShell, syncProfiles } from "./link";
import { mountPan } from "./Pan";
import { paneViews } from "./panes";
import { mountRail } from "./Rail";
import { type DeskState, emptyState, Store } from "./state";
import { Ticker } from "./ticker";

export interface DeskOptions {
  root: HTMLElement;
  /** What the shell itself needs from the host: audio, the brain's voice, the agent directory. */
  bridge: ShellBridge;
  /** The core, as the runtime reaches it: commands, plugins, init.yaml, the store. */
  core: BridgeClient;
  /** Where plugin files are served from; the runtime mounts the enabled UI plugins (the palette). */
  plugins: PluginHostOptions;
  clock?: Clock;
  lang?: Lang;
  /** "Mod" is ⌘ on mac and Ctrl elsewhere; detected from the browser unless given. */
  platform?: Platform;
  /** Wall-clock time at clock 0, for "started 4 minutes ago" (default: now). */
  epoch?: number;
  /** State to start from over the empty desk: the dev page and the fixtures seed the sample desk. */
  seed?: Partial<DeskState>;
}

export interface Desk {
  store: Store;
  ticker: Ticker;
  eris: ErisHandle;
  runtime: Runtime;
  /** Resolves once the plugins, the profile, the saved session and the agent directory are in. */
  ready: Promise<void>;
  /** Read the agent directory again. */
  refresh(): Promise<void>;
  dispose(): void;
}

export function mountDesk(options: DeskOptions): Desk {
  const clock = options.clock ?? realClock();
  const ticker = new Ticker(clock);
  const epoch = options.epoch ?? Date.now();
  const store = new Store({ ...emptyState(options.lang ?? "ko"), ...options.seed });
  const platform = options.platform ?? detectPlatform();
  const root = options.root;
  root.classList.add("shell");
  root.replaceChildren();

  const pending: ShellCtx["eris"] = {
    say: () => undefined,
    setState: () => undefined,
  };
  const windows = pluginWindows(store);
  // The runtime is created below; nothing reads it before then.
  const ctx: ShellCtx = {
    store,
    bridge: options.bridge,
    windows,
    runtime: undefined as unknown as Runtime,
    now: () => ticker.now(),
    ticker,
    tr: (key, vars) => t(store.get().lang, key, vars),
    reduced: () => ctx.runtime.theme().reducedMotion,
    wall: () => epoch + ticker.now(),
    platform,
    keyOf: (command) => ctx.runtime.keymap.keysFor(command)[0],
    eris: { say: (text, words) => pending.say(text, words), setState: (s) => pending.setState(s) },
  };

  const glow = h("div", { class: "shell-glow", "aria-hidden": "true" });
  const modeLayer = h("div", { class: "layer layer-mode", "data-layer": "mode" });
  const deskRoot = h("div", { class: "layer-desk" });
  modeLayer.append(deskRoot);
  const doc = root.ownerDocument;
  ctx.runtime = createRuntime({
    root: deskRoot,
    bridge: options.core,
    clock,
    platform,
    plugins: options.plugins,
    themeRoot: doc.documentElement,
    views: paneViews(ctx),
    // One window manager: the plugins' centre and floating surfaces are the shell's windows.
    windows,
  });
  const { runtime } = ctx;

  root.append(glow);
  const parts = [mountSystemLayer(root, ctx)];
  root.append(modeLayer);
  const eris = mountEris(modeLayer, ctx, () => layoutOf(store.get()).eris);
  pending.say = eris.say;
  pending.setState = eris.setState;
  parts.push(mountPan(root, ctx));
  parts.push(mountRail(modeLayer, ctx), mountBottom(modeLayer, ctx), mountSurfaces(modeLayer, ctx));

  const restored = keepShell(ctx);
  const offs = [
    defineCommands(ctx),
    syncProfiles(ctx),
    restored.off,
    runtime.onQuit(() => dismiss(ctx)),
    listen(doc, "pointerdown", (e) => {
      const target = e.target as Element | null;
      if (!target?.closest(".popover, .dialog, [aria-expanded], .composer")) {
        if (store.get().popover) store.set({ popover: null });
      }
    }),
  ];

  const refresh = () => loadDirectory(ctx);
  // The rail shows the brain the core has; a host without one leaves it offline.
  const brain = options.bridge.brain.status().then(
    (status) => store.set({ brain: status }),
    () => undefined,
  );
  const ready = (runtime.plugins?.ready ?? runtime.ready)
    .then(() => restored.done())
    .then(refresh)
    .then(() => brain)
    .then(() => runtime.commands.settled());

  return {
    store,
    ticker,
    eris,
    runtime,
    ready,
    refresh,
    dispose() {
      for (const off of offs) off();
      for (const off of parts) off();
      eris.dispose();
      runtime.dispose();
      ticker.dispose();
      glow.remove();
      modeLayer.remove();
      root.classList.remove("shell");
    },
  };
}
