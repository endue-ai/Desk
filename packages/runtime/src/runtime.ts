import type { BridgeClient, ProfileContribution } from "@endue-ai/bridge";
import type { Buffers } from "./buffers";
import { type Clock, realClock, tween } from "./clock";
import type { Commands } from "./commands";
import { Preferences } from "./core/preferences";
import { Edges, takesCell } from "./edges";
import { PolicyHub } from "./hub";
import { listenForShortcuts, type Platform, ShortcutRouter } from "./input";
import type { Keymap } from "./keymap";
import {
  type Cell,
  type Layout,
  type LayoutStorage,
  loadLayout,
  move,
  place,
  saveLayout,
} from "./layout";
import type { Notice, NoticeInput } from "./notify";
import { PluginHost, type PluginHostOptions } from "./plugins";
import { installAliases } from "./policies/aliases";
import { installBuffers } from "./policies/buffers";
import type { DeskContext } from "./policies/context";
import { installDisplay } from "./policies/display";
import { installFiles } from "./policies/files";
import { installKeys } from "./policies/keys";
import { installNotify } from "./policies/notify";
import { installPalette } from "./policies/palette";
import { installProfiles } from "./policies/profiles";
import { installSession, type SessionPart } from "./policies/session";
import { installTheme } from "./policies/theme";
import type { PolicySet } from "./policy";
import type { Settings } from "./settings";
import type { SettingsLanguage } from "./settings-ui/copy";
import { installSettingsWindow, type SettingsWindow } from "./settings-ui/window";
import { SurfaceHost, type SurfaceSpec } from "./surfaces";
import { applyTheme, type ThemeState } from "./theme";
import { connectViews, type HostViews, type ViewRouting } from "./views";

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
  /** Where the theme's tokens and data-scheme go; `root` unless a host (the shell) wraps the desk. */
  themeRoot?: HTMLElement;
  /** Views a host draws itself (the shell's panes): focus cycling and buffers reach them too. */
  views?: HostViews;
  /** Where centre and floating surfaces go instead of the grid: the shell's windows. */
  windows?: WindowHost;
  /** Native hosts may pick a file; null means the person cancelled. */
  pickFile?: () => Promise<string | null>;
}

export interface RuntimeProfiles {
  /** The profile in force, once one is. */
  active(): string | undefined;
  list(): ProfileContribution[];
  /** Hear every switch and save. */
  onChange(listener: () => void): () => void;
}

export interface RuntimePlugins {
  /** Resolves once the installed plugins are mounted (or the list could not be read). */
  readonly ready: Promise<void>;
  mounted(): string[];
  /** Send a command to a mounted plugin, for example `command("endue.eris", "state", "thinking")`. */
  command(id: string, name: string, args?: unknown): void;
  /** Take a plugin's surface away for the rest of this session (closing its window does this). */
  unmount(id: string): void;
}

/** The shell's window host places detached surfaces and removes them when closed (ADR 0040). */
export interface WindowHost {
  adopt(spec: SurfaceSpec, section: HTMLElement): void;
  release(id: string): void;
}

export interface Runtime {
  /** Resolves once the bridge answered and the status line shows the result. */
  readonly ready: Promise<void>;
  readonly shortcuts: ShortcutRouter;
  readonly plugins: RuntimePlugins | undefined;
  /** Every command the desk can run: keys, the palette and plugins call these ids. */
  readonly commands: Commands;
  /** Settings in layers: plugin defaults, init.yaml, the active profile, this session. */
  readonly settings: Settings;
  readonly preferences: Preferences;
  readonly settingsWindow: SettingsWindow;
  /** Core and plugin bindings with the person's layer last. */
  readonly keymap: Keymap;
  /** The buffer list (desk.buffers): plugin surfaces, their buffers and a host's views. */
  readonly buffers: Buffers;
  readonly profiles: RuntimeProfiles;
  /** Run when the person quits what is in progress (desk.keys.quit, Escape by default). */
  onQuit(handler: () => void): () => void;
  /** Keep a host's state in the session record (desk.session); returns a function that drops it. */
  keep(name: string, part: SessionPart): () => void;
  /** The policies the enabled plugins contribute, as collected last. */
  policy(): PolicySet;
  /** Show a notice in the status line, as desk.notify says; it goes to the history too. */
  notify(input: NoticeInput): Notice;
  /** The theme in force. */
  theme(): ThemeState;
  openSurface(spec: SurfaceSpec): void;
  closeSurface(id: string): void;
  moveSurface(id: string, cell: Cell): void;
  focusSurface(id: string | null): void;
  layout(): Layout;
  /** The status line text. */
  status(): string;
  dispose(): void;
}

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
    whenReady: (plugin) =>
      pluginHost ? pluginHost.whenReady(plugin) : Promise.reject(new Error("no plugin host")),
    unmount: (plugin) => {
      if (routing.owns(plugin)) views?.close(plugin);
      else if (pluginHost) pluginHost.unmount(plugin);
      else closeSurface(plugin);
    },
  };
  const theme = installTheme(ctx, options.themeRoot);
  const keys = installKeys(ctx, options.language ?? "ko");
  const preferences = new Preferences(hub.settings, bridge);
  const settingsWindow = installSettingsWindow(ctx, keys, preferences, options.language ?? "ko");
  // Contributed commands with `runs`, and the palette's providers, are the desk's to answer.
  const aliases = installAliases(ctx);
  const palette = installPalette(ctx);
  const notify = installNotify(ctx, statusLine);
  const focusSurface = (id: string | null) => {
    shortcuts.focus(id);
    if (id) surfaces.get(id)?.focus();
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
  const buffers = installBuffers(ctx, { focus: focusAny });
  routing = connectViews(views, buffers);
  const files = installFiles(ctx, buffers, notify.notify, options.pickFile);
  const session = installSession(ctx, buffers, {
    layout: () => structuredClone(layout),
    setLayout: (next) => commit(next),
    focus: focusSurface,
    focused: () => shortcuts.focused,
    notices: () => notify.notifications.history(),
    restoreNotices: (notices) => notify.notifications.restore(notices),
  });
  const profiles = installProfiles(ctx, (input) => notify.notify(input));
  notify.notifications.onPush(() => session.changed());
  onLayout = () => session.changed();
  onSurfaceFocus = (id) => {
    buffers.focused(id);
    session.changed();
  };
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
  };
  function closeSurface(id: string) {
    surfaces.close(id);
    options.windows?.release(id);
    buffers.surfaceClosed(id);
    if (shortcuts.focused === id) shortcuts.focus(null);
  }

  let plugins: RuntimePlugins | undefined;
  // Without plugins there is no desk.session to restore; saving may start at once.
  if (!options.plugins) void ready.then(() => session.restore());
  if (options.plugins) {
    const host = new PluginHost(
      {
        bridge,
        win,
        open: openSurface,
        close: closeSurface,
        reload: (id, src) => surfaces.reload(id, src),
        frame: (id) => surfaces.frame(id),
        show: (id, visible) => surfaces.show(id, visible),
        key: (id, key) => {
          shortcuts.focus(id);
          shortcuts.handle(key);
        },
        listed: (all) => hub.apply(all),
      },
      options.plugins,
    );
    pluginHost = host;
    plugins = {
      // A desk without plugin:manage still works; it just shows no plugins.
      ready: ready
        .then(() => host.start())
        // The desk's built-ins are in the registry before profiles and the session run them.
        .then(() => commands.settled())
        .then(() => profiles.start())
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
      routing.dispose();
      const policies = [profiles, session, files, buffers, display, notify, palette, aliases];
      for (const policy of [...policies, keys, theme]) {
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
