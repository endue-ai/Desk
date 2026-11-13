import type { BridgeClient } from "@endue-ai/bridge";
import { type Clock, realClock, tween } from "./clock";
import { Preferences } from "./core/preferences";
import { installDescribe } from "./describe/install";
import { Edges, edgeOf } from "./edges";
import { installFrames } from "./frames/install";
import { startsAsleep } from "./frames/start-asleep";
import { keepState } from "./frames/state";
import { PolicyHub } from "./hub";
import { listenForShortcuts, type Platform, ShortcutRouter } from "./input";
import { installInspect } from "./inspect/install";
import type { Notice } from "./notify";
import type { SurfacePages } from "./pages/types";
import { PluginHost, type PluginHostOptions } from "./plugins";
import { defineOpenPlugin } from "./plugins-open";
import { installAliases } from "./policies/aliases";
import { installBuffers } from "./policies/buffers";
import type { DeskContext } from "./policies/context";
import { keepLooks } from "./policies/design";
import { deskFolder } from "./policies/desk-folder";
import { installDisplay } from "./policies/display";
import { installFiles } from "./policies/files";
import { installKeys } from "./policies/keys";
import { installKeysFile } from "./policies/keys-file";
import { installNotify } from "./policies/notify";
import { installPalette } from "./policies/palette";
import { installProfiles } from "./policies/profiles";
import { installSession } from "./policies/session";
import { installTheme } from "./policies/theme";
import { chosenOf, mayMount, ROLES_SETTING } from "./roles";
import type { Runtime, RuntimePlugins } from "./runtime-api";
import type { SettingsLanguage } from "./settings-ui/copy";
import { installSettingsWindow } from "./settings-ui/window";
import { brokenRecordNotice, installStart, type StartInfo } from "./start";
import { SurfaceHost, type SurfaceSpec } from "./surfaces";
import { applyTheme } from "./theme";
import { timed } from "./timing";
import { connectViews, type HostViews, type ViewRouting } from "./views";
import type { WindowHost } from "./window-host";

export type { Runtime, RuntimePlugins, RuntimeProfiles } from "./runtime-api";

export interface RuntimeOptions {
  /** The element the desk takes over. */
  root: HTMLElement;
  bridge: BridgeClient;
  /** Inject a ManualClock in tests; defaults to the browser clock. */
  clock?: Clock;
  platform?: Platform;
  language?: SettingsLanguage;
  /** Mount the core's UI plugins; without it the desk shows only what callers open. */
  plugins?: PluginHostOptions;
  /** Native shells can bring a newly shown overlay to the foreground. */
  onSurfaceShown?(id: string): void;
  /** Where the theme's tokens and data-scheme go; `root` unless a host (the shell) wraps the desk. */
  themeRoot?: HTMLElement;
  /** Views a host draws itself (the shell's panes): focus cycling and buffers reach them too. */
  views?: HostViews;
  /** Where normal content and side panels go: the shell's movable windows. */
  windows?: WindowHost;
  /**
   * How each surface's page is reached: in the app a browser of its own that the compositor draws
   * (`remotePages`); without it, sandboxed frames of this page (ADR 0160).
   */
  pages?: SurfacePages;
  /** Native hosts may pick a file; null means the person cancelled. */
  pickFile?: () => Promise<string | null>;
  /** The host's name for a file, links followed and home as `~`, so one file is one buffer. */
  realPath?: (path: string) => Promise<string>;
  /** What the host found at start (ADR 0061), and how it starts the desk again without safe mode. */
  start?: StartInfo;
  relaunch?: () => void | Promise<void>;
}

export type { WindowHost } from "./window-host";

const FADE_MS = 240;
/**
 * Mount the desk's system surface (ADR 0160): its policies, the plugin host, settings and the status
 * line, and the sections of the surfaces it shows, for the window host and its edge bars. It moves no
 * window and lays none out: the compositor draws every surface where desk-wm places it, and a desk
 * without a window host shows its surfaces side by side in the order they opened.
 */
export function createRuntime(options: RuntimeOptions): Runtime {
  const { root, bridge } = options;
  const clock = options.clock ?? realClock();
  const doc = root.ownerDocument;
  const win = doc.defaultView ?? window;

  root.classList.add("desk");
  root.replaceChildren();
  // The built-in tokens until desk.theme applies the theme in force, where it will apply it.
  applyTheme(options.themeRoot ?? root);

  const container = doc.createElement("main");
  container.className = "desk-surfaces";
  const statusLine = doc.createElement("footer");
  statusLine.className = "desk-status";
  statusLine.setAttribute("role", "status");
  statusLine.setAttribute("aria-live", "polite");
  statusLine.style.opacity = "0";
  root.append(container, statusLine);

  const hub = new PolicyHub(bridge);
  const { commands } = hub;
  const shortcuts = new ShortcutRouter({ platform: options.platform ?? "other" });
  // Set once desk.buffers is installed: the surface in use decides the buffer in use.
  let onSurfaceFocus: (id: string) => void = () => {};
  // Set once the frames are installed: the focus order decides which frames stay live (ADR 0134).
  let focusMoved: (id: string | null) => void = () => {};
  const surfaces = new SurfaceHost(
    container,
    (id) => {
      shortcuts.focus(id);
      focusMoved(id);
      onSurfaceFocus(id);
    },
    new Edges(container),
    options.pages,
  );

  const offKeys = listenForShortcuts(win, shortcuts);

  // Built before the policies so they can share messages with plugins and ask them things.
  let pluginHost: PluginHost | undefined;
  const ctx: DeskContext = {
    hub,
    root,
    win,
    clock,
    bridge,
    shortcuts,
    surfaces,
    share: (message) => pluginHost?.share(message),
    request: (plugin, command, args) =>
      pluginHost
        ? pluginHost.request(plugin, command, args)
        : Promise.reject(new Error(`${plugin} is not running`)),
    mounted: (plugin) => pluginHost?.mounted().includes(plugin) ?? false,
    launch: (plugin) =>
      pluginHost ? pluginHost.launch(plugin) : Promise.reject(new Error("no plugin host")),
    whenReady: (plugin) =>
      pluginHost ? pluginHost.whenReady(plugin) : Promise.reject(new Error("no plugin host")),
    unmount: (plugin) => {
      if (routing.owns(plugin)) views?.close(plugin);
      else if (pluginHost) pluginHost.unmount(plugin);
      else closeSurface(plugin);
    },
  };
  const theme = installTheme(ctx, options.themeRoot, options.plugins?.url);
  const notify = installNotify(ctx, statusLine);
  const keys = installKeys(ctx, options.language ?? "ko", notify.notify);
  const preferences = new Preferences(hub.settings, bridge);
  const settingsWindow = installSettingsWindow(ctx, keys, preferences, options.language ?? "ko");
  // Contributed commands with `runs`, and the palette's providers, are the desk's to answer.
  const aliases = installAliases(ctx);
  const palette = installPalette(ctx);
  const focusSurface = (id: string | null) => {
    shortcuts.focus(id);
    focusMoved(id);
    if (id) {
      options.windows?.show?.(id);
      surfaces.focus(id);
    }
  };
  const { views, windows, language } = options;
  // Set once desk.buffers is installed: which ids are the host's views.
  let routing: ViewRouting = { owns: () => false, dispose: () => {} };
  const focusAny = (id: string | null) => {
    if (id && routing.owns(id)) {
      focusSurface(null);
      views?.focus(id);
    } else focusSurface(id);
  };
  const display = installDisplay(ctx, {
    focus: focusAny,
    visible: () => [
      ...(views?.ids() ?? []),
      ...surfaces.ids().filter((id) => surfaces.visible(id)),
    ],
    focused: () => shortcuts.focused ?? views?.focused() ?? null,
  });
  // Windows out of sight are unloaded, their state kept (ADR 0070); every frame is watched (#39).
  const frames = installFrames(ctx, { windows, host: () => pluginHost, lang: language });
  focusMoved = (id) => frames.focused(id);
  // A host's view is a buffer only while in sight; a surface is when shown and on the page.
  const inSight = (id: string) => surfaces.get(id) === undefined || surfaces.visible(id);
  const buffers = installBuffers(ctx, { focus: focusAny, inSight });
  routing = connectViews(views, buffers);
  const broken = (key: string) => notify.notify(brokenRecordNotice(key, options.start?.dataDir));
  const files = installFiles(
    ctx,
    buffers,
    notify.notify,
    options.pickFile,
    broken,
    options.realPath,
  );
  const actions = {
    focus: focusSurface,
    focused: () => shortcuts.focused,
    notices: () => notify.notifications.history(),
    restoreNotices: (notices: Notice[]) => notify.notifications.restore(notices),
  };
  const session = installSession(ctx, buffers, actions, { hold: !!options.start?.safe, broken });
  const { start: info, relaunch } = options;
  const start = installStart(ctx, { notify: notify.notify, save: session.save, info, relaunch });
  // The person's files in ~/.desk (ADR 0079): saved profiles, and key bindings in keys.yaml.
  const folder = deskFolder(bridge);
  const profiles = installProfiles(ctx, (input) => notify.notify(input), folder);
  const keysFile = installKeysFile(ctx, (input) => notify.notify(input), folder);
  const about = installDescribe(ctx, { keys, profile: profiles.active, notify: notify.notify });
  const inspect = installInspect(ctx, { buffers: buffers.buffers, views, frames });
  notify.notifications.onPush(() => session.changed());
  onSurfaceFocus = (id) => {
    buffers.focused(id);
    session.changed();
  };
  keepLooks(session, hub.settings);
  keys.onQuit(() => notify.notifications.dismiss());
  keys.onQuit(() => {
    if (commands.has("desk.palette.cancel"))
      void commands.run("desk.palette.cancel").catch(() => {});
  });
  const showStatus = (text: string) => {
    notify.setBase(text);
    const durationMs = theme.state().reducedMotion ? 0 : FADE_MS;
    void tween(clock, { from: 0, to: 1, durationMs }, (value) => {
      statusLine.style.opacity = String(Math.round(value * 1000) / 1000);
    });
  };

  const ready = bridge.call("perm.query", {}).then(
    async () => {
      await Promise.all([hub.readInit(bridge), files.load(), preferences.load()]);
      await commands.settled();
      showStatus(`desk ready · bridge: ${bridge.adapterName}`);
      if (hub.initProblem) {
        notify.notify({
          caller: "desk",
          title: "init.yaml is not in force",
          body: hub.initProblem,
          level: "warning",
        });
      }
    },
    () => showStatus(`desk cannot reach the core · bridge: ${bridge.adapterName}`),
  );
  const openSurface = (spec: SurfaceSpec) => {
    const decision = display.decide(spec);
    // Content and side panels share the window manager; overlays and the dock keep their roles.
    const windowed =
      options.windows !== undefined && !["overlay", "bottom"].includes(decision.area);
    const placed = { ...spec, placement: decision.area };
    const section = surfaces.open(placed, windowed ? null : undefined);
    if (windowed) options.windows?.adopt(placed, section);
    display.sizeEdge(section, decision);
    // Overlays cover the desk and edge surfaces sit around it; the rest are buffers.
    if ((windowed || takesBuffer(decision.area)) && !spec.hidden) {
      buffers.surfaceOpened(spec.id, spec.title);
    }
    // A visible overlay is modal: a surface that mounts under it does not take the focus from it.
    const modal = root.querySelector(".desk-surface--overlay:not([hidden])");
    if (decision.focus && !spec.hidden && (decision.area === "overlay" || !modal)) {
      focusSurface(spec.id);
    }
    frames.opened(placed, windowed);
  };
  function closeSurface(id: string) {
    frames.closed(id);
    surfaces.close(id);
    options.windows?.release(id);
    buffers.surfaceClosed(id);
    if (shortcuts.focused === id) shortcuts.focus(null);
  }

  let plugins: RuntimePlugins | undefined;
  // Without plugins there is no desk.session to restore; saving may start at once.
  if (!options.plugins) void ready.then(() => keysFile.start()).then(() => session.restore());
  if (options.plugins) {
    const host = new PluginHost(
      {
        bridge,
        win,
        open: openSurface,
        close: closeSurface,
        reload: (id, src) => frames.reload(id, src),
        frame: (id) => surfaces.frame(id),
        show: (id, visible) => {
          surfaces.show(id, visible);
          if (visible) {
            options.windows?.show?.(id);
            options.onSurfaceShown?.(id);
          }
        },
        key: (id, key) => {
          shortcuts.focus(id);
          shortcuts.handle(key);
        },
        listed: (all) => hub.apply(all),
        outcome: (id, ok) => start.outcome(id, ok),
        wake: (id) => frames.wake(id),
        // A role named in desk.roles is its provider's alone (ADR 0104).
        mayMount: (info) => mayMount(info, chosenOf(hub.settings.get(ROLES_SETTING))),
        // Under a window host the side surfaces are windows: a closed one stays closed (#163).
        startAsleep: async (all) =>
          startsAsleep(all, surfaces.returning(await session.shows()), {
            windows: options.windows !== undefined,
          }),
      },
      options.plugins,
    );
    pluginHost = host;
    hub.settings.onChange((keys) => keys.includes(ROLES_SETTING) && void host.reconcile());
    defineOpenPlugin({
      commands,
      bridge,
      launch: (id, waitForReady) => host.launch(id, waitForReady),
      focus: focusSurface,
    });
    plugins = {
      // A desk without plugin:manage still works: it shows no plugins and says why (start.failed).
      ready: ready
        .then(() => Promise.all([host.start(), keysFile.start()]))
        // The desk's built-ins are in the registry before profiles and the session run them.
        .then(() => timed("command registry", () => commands.settled()))
        .then(() => timed("profile start", () => profiles.start()))
        .then(() => session.restore().then(() => files.settle()))
        .then(() => commands.settled())
        .catch(start.failed),
      mounted: () => host.mounted(),
      command: (id, name, args) => host.command(id, name, args),
      unmount: (id) => host.unmount(id),
      wake: (id) => host.wake(id),
      keep: (id, surface) => keepState(host, id, surface),
    };
  }

  return {
    ready,
    shortcuts,
    plugins,
    commands,
    settings: hub.settings,
    preferences,
    settingsWindow,
    keymap: keys.keymap,
    buffers: buffers.buffers,
    frames: frames.responses,
    profiles: {
      active: () => profiles.active(),
      list: () => profiles.list(),
      saved: () => profiles.saved(),
      onChange: (listener) => profiles.onChange(listener),
    },
    onQuit: (handler) => keys.onQuit(handler),
    keep: (name, part) => session.keep(name, part),
    policy: () => hub.policy,
    notify: (input) => notify.notify(input),
    theme: () => theme.state(),
    themes: theme,
    designs: theme.designs,
    openSurface,
    closeSurface,
    focusSurface,
    status: () => notify.text(),
    dispose() {
      settingsWindow.dispose();
      preferences.dispose();
      frames.dispose();
      routing.dispose();
      const policies = [
        start,
        profiles,
        keysFile,
        folder,
        session,
        files,
        buffers,
        display,
        notify,
      ];
      for (const policy of [about, inspect, ...policies, palette, aliases, keys, theme]) {
        policy.dispose();
      }
      pluginHost?.stop();
      commands.dispose();
      offKeys();
      for (const id of surfaces.ids()) surfaces.close(id);
      root.replaceChildren();
    },
  };
}
/** Overlays and edge surfaces are the desk's chrome; every other surface is a buffer. */
const takesBuffer = (area: string) => area !== "overlay" && edgeOf(area) === undefined;
