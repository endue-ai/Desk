import type { BridgeClient } from "@endue-ai/bridge";
import { type Clock, realClock, tween } from "./clock";
import { Preferences } from "./core/preferences";
import { installDescribe } from "./describe/install";
import { Edges, takesCell } from "./edges";
import { installFrames } from "./frames/install";
import { PolicyHub } from "./hub";
import { listenForShortcuts, type Platform, ShortcutRouter } from "./input";
import { installInspect } from "./inspect/install";
import { type Layout, type LayoutStorage, loadLayout, move, place, saveLayout } from "./layout";
import type { Notice } from "./notify";
import { PluginHost, type PluginHostOptions } from "./plugins";
import { installAliases } from "./policies/aliases";
import { installBuffers } from "./policies/buffers";
import type { DeskContext } from "./policies/context";
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
  /** Where the layout is saved; defaults to an in-memory store. */
  storage?: LayoutStorage;
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
  /** Where centre and floating surfaces go instead of the grid: the shell's windows. */
  windows?: WindowHost;
  /** Native hosts may pick a file; null means the person cancelled. */
  pickFile?: () => Promise<string | null>;
  /** What the host found at start (ADR 0061), and how it starts the desk again without safe mode. */
  start?: StartInfo;
  relaunch?: () => void | Promise<void>;
}

export type { WindowHost } from "./window-host";

const FADE_MS = 240;
/** Mount the 2D desk: a compositor grid of sandboxed surfaces, edge bars and a status line. */
export function createRuntime(options: RuntimeOptions): Runtime {
  const { root, bridge } = options;
  const clock = options.clock ?? realClock();
  const storage = options.storage ?? memoryStorage();
  const doc = root.ownerDocument;
  const win = doc.defaultView ?? window;

  root.classList.add("desk");
  root.replaceChildren();
  // The built-in tokens until desk.theme applies the theme in force, where it will apply it.
  applyTheme(options.themeRoot ?? root);

  const compositor = doc.createElement("main");
  compositor.className = "desk-compositor";
  const statusLine = doc.createElement("footer");
  statusLine.className = "desk-status";
  statusLine.setAttribute("role", "status");
  statusLine.setAttribute("aria-live", "polite");
  statusLine.style.opacity = "0";
  root.append(compositor, statusLine);

  let layout = loadLayout(storage);
  const hub = new PolicyHub(bridge);
  const { commands } = hub;
  const shortcuts = new ShortcutRouter({ platform: options.platform ?? "other" });
  // Set once desk.buffers is installed: the surface in use decides the buffer in use.
  let onSurfaceFocus: (id: string) => void = () => {};
  const surfaces = new SurfaceHost(
    compositor,
    (id) => {
      shortcuts.focus(id);
      onSurfaceFocus(id);
    },
    new Edges(compositor),
  );

  const applyGrid = () => {
    compositor.style.gridTemplateColumns = `repeat(${layout.columns}, minmax(0, 1fr))`;
    compositor.style.gridTemplateRows = `repeat(${layout.rows}, minmax(0, 1fr))`;
    for (const id of surfaces.ids()) {
      const cell = layout.cells[id];
      if (cell) surfaces.position(id, cell);
    }
  };
  // Set once desk.session is installed: a new layout is worth keeping.
  let onLayout: () => void = () => {};
  const commit = (next: Layout) => {
    layout = next;
    saveLayout(storage, layout);
    applyGrid();
    onLayout();
  };
  applyGrid();
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
  const keys = installKeys(ctx, options.language ?? "ko");
  const preferences = new Preferences(hub.settings, bridge);
  const settingsWindow = installSettingsWindow(ctx, keys, preferences, options.language ?? "ko");
  // Contributed commands with `runs`, and the palette's providers, are the desk's to answer.
  const aliases = installAliases(ctx);
  const palette = installPalette(ctx);
  const notify = installNotify(ctx, statusLine);
  const focusSurface = (id: string | null) => {
    shortcuts.focus(id);
    if (id) {
      options.windows?.show?.(id);
      surfaces.get(id)?.focus();
    }
  };
  const { views } = options;
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
  // Centre and floating surfaces out of sight are unloaded, their state kept (ADR 0070).
  const frames = installFrames(ctx, { windows: options.windows, host: () => pluginHost });
  const buffers = installBuffers(ctx, { focus: focusAny });
  routing = connectViews(views, buffers);
  const broken = (key: string) => notify.notify(brokenRecordNotice(key, options.start?.dataDir));
  const files = installFiles(ctx, buffers, notify.notify, options.pickFile, broken);
  const actions = {
    layout: () => structuredClone(layout),
    setLayout: (next: Layout) => commit(next),
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
  const inspect = installInspect(ctx, { buffers: buffers.buffers, views });
  notify.notifications.onPush(() => session.changed());
  onLayout = () => session.changed();
  onSurfaceFocus = (id) => {
    buffers.focused(id);
    session.changed();
  };
  const { settings } = hub;
  // The theme the person chose comes back with the session.
  session.keep("theme", {
    save: () => settings.layer("session")["desk.theme.active"] ?? null,
    restore: (value) => {
      if (typeof value === "string") settings.set("desk.theme.active", value);
    },
    onChange: (listener) =>
      settings.onChange((changed) => changed.includes("desk.theme.active") && listener()),
  });
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
    // With a window host, centre and floating surfaces are its windows, not grid cells.
    const windowed =
      options.windows !== undefined && (decision.area === "center" || decision.area === "floating");
    const placed = { ...spec, placement: decision.area };
    const section = surfaces.open(placed, windowed ? null : undefined);
    if (windowed) options.windows?.adopt(placed, section);
    // Overlays cover the desk and edge surfaces sit around it; only grid surfaces take cells.
    else if (takesCell(decision.area)) {
      commit(place(layout, spec.id, { colSpan: decision.columns, rowSpan: decision.rows }));
    }
    display.sizeEdge(section, decision);
    if ((decision.area === "center" || decision.area === "floating") && !spec.hidden) {
      buffers.surfaceOpened(spec.id, spec.title);
    }
    // A visible overlay is modal: a surface that mounts under it does not take the focus from it.
    const modal = root.querySelector(".desk-surface--overlay:not([hidden])");
    if (decision.focus && !spec.hidden && (decision.area === "overlay" || !modal)) {
      focusSurface(spec.id);
    }
    frames.opened(placed);
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
        reload: (id, src) => surfaces.reload(id, src),
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
      },
      options.plugins,
    );
    pluginHost = host;
    commands.define("desk.plugins.open", {
      title: "Open a plugin",
      owner: "desk",
      keywords: ["launch", "application"],
      run: async (args) => {
        const id = (args as { plugin?: unknown })?.plugin;
        if (typeof id !== "string") throw new Error("Choose a plugin to open");
        await host.launch(id, (args as { waitForReady?: unknown }).waitForReady === true);
        focusSurface(id);
      },
    });
    plugins = {
      // A desk without plugin:manage still works; it just shows no plugins.
      ready: ready
        .then(() => Promise.all([host.start(), keysFile.start()]))
        // The desk's built-ins are in the registry before profiles and the session run them.
        .then(() => timed("command registry", () => commands.settled()))
        .then(() => timed("profile start", () => profiles.start()))
        .then(() => session.restore().then(() => files.settle()))
        .then(() => commands.settled())
        .catch(() => {}),
      mounted: () => host.mounted(),
      command: (id, name, args) => host.command(id, name, args),
      unmount: (id) => host.unmount(id),
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
    profiles: {
      active: () => profiles.active(),
      list: () => profiles.list(),
      onChange: (listener) => profiles.onChange(listener),
    },
    onQuit: (handler) => keys.onQuit(handler),
    keep: (name, part) => session.keep(name, part),
    policy: () => hub.policy,
    notify: (input) => notify.notify(input),
    theme: () => theme.state(),
    themes: theme,
    openSurface,
    closeSurface,
    moveSurface(id, cell) {
      commit(move(layout, id, cell));
    },
    focusSurface,
    layout: () => structuredClone(layout),
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
function memoryStorage(): LayoutStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}
