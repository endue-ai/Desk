/**
 * The desk shell in two layers. The system layer holds the desk's own controls at fixed places
 * (profile switcher, desktops, agent bar); the mode layer holds what a profile lays out (Eris, the
 * rail, the bottom edge, surfaces) over the runtime (plugin surfaces, the status line). The runtime
 * is the one desk under both: its commands, keymap, settings, theme, profiles and session are the
 * shell's. The centre stays empty. Tab order follows the DOM:
 * profiles → desktops → agent bar → plugin surfaces → Eris → rail → bottom → surfaces → arrange
 * strip. The canvas map is the compositor's (#54).
 */
import type { BridgeClient } from "@endue-ai/bridge";
import type { ShellBridge } from "../bridge/types";
import { type Clock, realClock } from "../clock";
import { type ErisHandle, mountEris } from "../eris/Eris";
import { detectPlatform, type Platform } from "../input";
import type { SurfacePages } from "../pages/types";
import type { PluginHostOptions } from "../plugins";
import { installProposals } from "../propose/install";
import { createRuntime, type Runtime } from "../runtime";
import type { StartInfo } from "../start";
import { pluginWindows } from "../surface/host";
import { wakePlaced } from "../surface/placed";
import { mountSurfaces } from "../surface/Surface";
import type { WindowPages } from "../surface/window-pages";
import { loadDirectory } from "../system/agents";
import { loadEndue, watchEndue } from "../system/endue";
import { mountSystemLayer } from "../system/layer";
import { defineLocalAgentCommands } from "../system/local-agent-commands";
import { loadLocalAgents, watchLocalAgents } from "../system/local-agents";
import { timed } from "../timing";
import { mountWallpaper } from "../wallpaper/wallpaper";
import { heldWindows, noWindowManager, type WindowManagerHost } from "../wm/host";
import type { Rect } from "../wm/types";
import { takeDesk } from "../wm/view";
import { layoutOf } from "./actions";
import { mountBottom } from "./Bottom";
import { defineCommands, dismiss } from "./commands";
import type { ShellCtx } from "./context";
import { type Lang, t } from "./copy";
import { defineDeskView } from "./desk-view";
import { h, listen } from "./dom";
import { keepShell, syncProfiles } from "./link";
import { mountPan } from "./Pan";
import { paneViews } from "./panes";
import { mountRail } from "./Rail";
import { byRole } from "./roles";
import { type DeskState, emptyState, Store } from "./state";
import { Ticker } from "./ticker";
import { showPlugin } from "./windows";

export interface DeskOptions {
  root: HTMLElement;
  /** What the shell itself needs from the host: audio, the brain's voice, the agent directory. */
  bridge: ShellBridge;
  /** The core, as the runtime reaches it: commands, plugins, init.yaml, the store. */
  core: BridgeClient;
  /** Where plugin files are served from; the runtime mounts the enabled UI plugins (the palette). */
  plugins: PluginHostOptions;
  /** Native hosts may pick a file; cancellation leaves the desk unchanged. */
  pickFile?: () => Promise<string | null>;
  /** The host's name for a file, links followed and home as `~`, so one file is one buffer. */
  realPath?: (path: string) => Promise<string>;
  /** Let the native host reveal a shared picker opened by a background command. */
  onSurfaceShown?(id: string): void;
  clock?: Clock;
  lang?: Lang;
  /** "Mod" is ⌘ on mac and Ctrl elsewhere; detected from the browser unless given. */
  platform?: Platform;
  /** Wall-clock time at clock 0, for "started 4 minutes ago" (default: now). */
  epoch?: number;
  /** State to start from over the empty desk: the dev page and the fixtures seed the sample desk. */
  seed?: Partial<DeskState>;
  /** What the host found at start: safe mode and the state files kept broken (ADR 0061). */
  start?: StartInfo;
  /** Start the desk again without safe mode ("Start normally"); only a native host can. */
  relaunch?: () => void | Promise<void>;
  /**
   * The window manager (crates/desk-wm, #83): it holds the windows, the panes, the desktops, the
   * drawer and the pan, takes every change as an edit and publishes the desk, runs the gestures
   * and window commands and keeps the live budget. The CEF shell's compositor in the app (ADR 0153);
   * the same window manager as WebAssembly on a desk without it (`wm/local.ts`, the runtime's tests
   * and fixture pages). Without one the desk holds no window.
   */
  windowManager?: WindowManagerHost;
  /**
   * How the runtime reaches each plugin surface's page: in the app a browser of its own the
   * compositor draws (`remotePages`, ADR 0160); without it, frames of this page.
   */
  pages?: SurfacePages;
  /**
   * Where each window's section lies: in the app a page of the window's own, which the compositor
   * draws from a texture of its own (ADR 0201); without it, this page.
   */
  windowPages?: (layer: HTMLElement) => WindowPages;
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
  /** Lay window `id` out at `rect` while the host's gesture holds it; `null` lets it go. */
  hold(id: string | null, rect?: Rect): void;
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
  const wm = options.windowManager ?? noWindowManager();
  // Every desk the window manager publishes is the store's, whole.
  wm.connect((published) => takeDesk(store, published));
  // A seeded drawer (the dev page's and the fixtures' sample desk) is the window manager's too.
  const seeded = options.seed?.drawer;
  if (seeded?.length) {
    void wm.edit([{ op: "drawer", items: seeded.map((d) => ({ ...d, at: Math.round(d.at) })) }]);
  }
  const windows = pluginWindows(
    store,
    () => wm,
    (id) => void showPlugin(ctx, id),
  );
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
    wm,
    held: heldWindows(),
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
    language: options.lang ?? "ko",
    plugins: options.plugins,
    pickFile: options.pickFile,
    ...(options.realPath ? { realPath: options.realPath } : {}),
    onSurfaceShown: options.onSurfaceShown,
    ...(options.start ? { start: options.start } : {}),
    ...(options.relaunch ? { relaunch: options.relaunch } : {}),
    themeRoot: doc.documentElement,
    views: paneViews(ctx),
    // One window manager: the plugins' centre and floating surfaces are the shell's windows.
    windows,
    ...(options.pages ? { pages: options.pages } : {}),
  });
  const { runtime } = ctx;

  root.append(glow);
  const parts = [mountWallpaper(root, ctx), mountSystemLayer(root, ctx, options.start?.safe)];
  root.append(modeLayer);
  const eris = mountEris(modeLayer, ctx, () => layoutOf(store.get()).eris);
  pending.say = eris.say;
  pending.setState = eris.setState;
  parts.push(mountPan(root, ctx));
  // The rail and the bottom edge fill their roles until desk.roles names another provider (ADR 0104).
  const settings = ctx.runtime.settings;
  parts.push(
    byRole(modeLayer, "role:rail", settings, (at) => mountRail(at, ctx)),
    byRole(modeLayer, "role:dock", settings, (at) => mountBottom(at, ctx)),
    // The canvas map beside the arrange strip is the compositor's (#54, ADR 0161).
    mountSurfaces(modeLayer, ctx, options.windowPages),
  );

  const restored = keepShell(ctx);
  // A plugin that started asleep (ADR 0070) wakes when a window of the desktop in front places it.
  const placed = wakePlaced(ctx);
  const offs = [
    defineCommands(ctx),
    // Eris sees the windows (ADR 0109): desk.windows.list answers what the composer sends.
    defineDeskView(ctx),
    // The agent programs on this computer (ADR 0110): the agent bar lists them, and their
    // desk.agents.* commands are Eris's tools.
    defineLocalAgentCommands(ctx),
    watchLocalAgents(ctx),
    // Signing in or out swaps the agent bar between endue's agents and the directory (ADR 0129).
    watchEndue(ctx),
    // desk.propose: Eris makes views, profiles and key bindings from a sentence and says what she
    // made (ADR 0073). Its provenance takes the wall clock (Date.now), not the frame loop's time;
    // the card for profiles and keys sits over the whole shell.
    installProposals({
      bridge: options.core,
      commands: runtime.commands,
      notify: (input) => runtime.notify(input),
      profile: () => runtime.profiles.active(),
      eris: ctx.eris,
      desk: { host: root, settings: runtime.settings, policy: () => runtime.policy(), platform },
    }),
    syncProfiles(ctx),
    restored.off,
    placed.off,
    runtime.onQuit(() => dismiss(ctx)),
    listen(doc, "pointerdown", (e) => {
      const target = e.target as Element | null;
      if (!target?.closest(".popover, .dialog, [aria-expanded], .composer")) {
        if (store.get().popover) store.set({ popover: null });
      }
    }),
  ];

  // The local agents come in at once and on their own: reading their sessions never holds the
  // desk's start, and the start never holds them (a saved file whose plugin waits on a permission
  // prompt holds the session's restore). refresh reads them again with the agent directory. The
  // person's endue agents and spaces never hold the start either: endue AI may be slow to answer.
  void loadLocalAgents(ctx);
  const refresh = () => {
    void loadLocalAgents(ctx);
    void loadEndue(ctx);
    return loadDirectory(ctx);
  };
  // The rail shows the brain the core has; a host without one leaves it offline.
  const brain = options.bridge.brain.status().then(
    (status) => store.set({ brain: status }),
    () => undefined,
  );
  const ready = (runtime.plugins?.ready ?? runtime.ready)
    .then(() => restored.done())
    .then(() => placed.now())
    .then(() => timed("agent directory", refresh))
    .then(() => brain)
    .then(() => runtime.commands.settled());

  return {
    store,
    ticker,
    eris,
    runtime,
    ready,
    refresh,
    hold: (id, rect) => ctx.held.hold(id, rect),
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
