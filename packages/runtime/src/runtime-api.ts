/** The runtime's public services, independent of its mounting and lifecycle wiring. */
import type { PluginInfo, ProfileContribution } from "@endue-ai/bridge";
import type { Buffers } from "./buffers";
import type { Commands } from "./commands";
import type { Preferences } from "./core/preferences";
import type { FrameResponses } from "./frames/watch";
import type { ShortcutRouter } from "./input";
import type { Keymap } from "./keymap";
import type { Notice, NoticeInput } from "./notify";
import type { RuntimeDesigns } from "./policies/design";
import type { SessionPart } from "./policies/session";
import type { RuntimeThemes } from "./policies/theme";
import type { PolicySet } from "./policy";
import type { Settings } from "./settings";
import type { SettingsWindow } from "./settings-ui/window";
import type { SurfaceSpec } from "./surfaces";
import type { ThemeState } from "./theme";

export interface RuntimeProfiles {
  /** The profile in force, once one is. */
  active(): string | undefined;
  list(): ProfileContribution[];
  /** The ids of the profiles the person saved, a file over a contributed profile among them. */
  saved(): string[];
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
  /** Open the surface of a plugin that started asleep (#590), as a window placing it asks. */
  wake(id: string): void;
  /**
   * Another window of a running plugin (ADR 0212): its key. `before` hears the key before the
   * window opens, to ask the window manager for the tab that takes it (ADR 0268).
   */
  another?(id: string, before?: (key: string) => void): string;
  /**
   * Ask a plugin for its surface's state and keep it for its next page, as an unload does: before
   * its window moves into or out of an OS window (issue 235), which loads its page again.
   */
  keep?(id: string, surface?: string): Promise<void>;
  /** The installed plugins as plugin.list said last: empty until it first answers. */
  listed?(): readonly PluginInfo[];
  /** Hear each new list of the installed plugins. */
  onListed?(listener: () => void): () => void;
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
  /** Whether each plugin frame answers the desk, and Wait, Stop and Reload for one that does not (#39). */
  readonly frames: FrameResponses;
  readonly profiles: RuntimeProfiles;
  /** Run when the person quits what is in progress (desk.keys.quit, Escape by default). */
  onQuit(handler: () => void): () => void;
  /** Keep a host's state in the session record (desk.session); returns a function that drops it. */
  keep(name: string, part: SessionPart): () => void;
  /** The policies the enabled plugins contribute, as collected last. */
  policy(): PolicySet;
  /** Show a notice in the status line, as desk.notify says; it goes to the history too. */
  notify(input: NoticeInput): Notice;
  /** The notices that show, and what a click elsewhere (an OS notification, #306) does to one. */
  readonly notices: RuntimeNotices;
  /** The theme in force. */
  theme(): ThemeState;
  /** The theme system: installed themes, the one in force, preview and apply (ADR 0056). */
  readonly themes: RuntimeThemes;
  /** The design systems: installed ones, the one in force, preview, apply and change (ADR 0090). */
  readonly designs: RuntimeDesigns;
  openSurface(spec: SurfaceSpec): void;
  closeSurface(id: string): void;
  /** Ask for surface `id` in use; settles once the window manager that holds its window said. */
  focusSurface(id: string | null): undefined | Promise<unknown>;
  /**
   * The window manager has surface `id` in use: the page's focus goes along, asking nothing.
   * `told`: it decided unasked, so an overlay with the page's focus keeps it.
   */
  followSurface(id: string | null, told?: boolean): void;
  /** The status line text. */
  status(): string;
  dispose(): void;
}

/** desk.notify's notices for hosts outside the page (#306). */
export interface RuntimeNotices {
  /** Hear every notice that shows: not one do not disturb holds back. Returns what stops it. */
  onShown(listener: (notice: Notice) => void): () => void;
  /** Act on notice `id` as a click would: its first action with `action`, else open its source. */
  activate(id: string, action: boolean): Promise<void>;
}
