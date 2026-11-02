/**
 * desk.theme: resolve the theme from its settings, the OS and the theme plugin desk.theme.active names,
 * apply it (tokens and fonts), and share it with plugins. The studio reaches the core's theme.* and,
 * for Describe, brain.ask through it.
 */
import type {
  BrainAskTool,
  BrainStatusResult,
  BrainTurnData,
  ThemePackage,
} from "@endue-ai/bridge";
import {
  applyThemeState,
  DEFAULT_THEME_SETTINGS,
  type InstalledTheme,
  mediaPreferences,
  resolveTheme,
  type Scheme,
  type ThemeSettings,
  type ThemeState,
} from "../theme";
import { applyThemeFonts, fontHost } from "../theme-fonts";
import { type DeskContext, disposer, type Installed } from "./context";

export interface ThemePolicy extends Installed, RuntimeThemes {}

/** The theme system as the main UI drives it (the theme studio, ADR 0056). */
export interface RuntimeThemes {
  /** The theme in force (or previewed): its tokens, fonts and the gate's fixes. */
  state(): ThemeState;
  /** The installed theme plugins, in layer order. */
  installed(): InstalledTheme[];
  /** The theme plugin desk.theme.active names; empty for the endue theme. */
  active(): string;
  /** Show a theme on the whole desk without choosing it (`""` the endue theme); undefined ends it. */
  preview(id: string | undefined): void;
  /** The theme previewed now, if any. */
  previewing(): string | undefined;
  /**
   * Choose a theme (`""` the endue theme): desk.theme.active, kept with the session. With `scheme`, the
   * desk takes that scheme too (a theme described for one scheme only is applied as it was previewed).
   */
  apply(id: string, scheme?: Scheme): void;
  /** What the desk would look like with a theme, under the contrast in force and a scheme. */
  resolve(id: string, scheme?: Scheme): ThemeState;
  /** Hear when the theme in force, the preview or the installed themes change. */
  onChange(listener: () => void): () => void;
  /**
   * Preview a theme that is not installed yet (the studio's editor): its block and where its files
   * are (path to URL, data: URLs for files not saved yet). undefined ends it.
   */
  previewDraft(
    theme: ThemePackage | undefined,
    files?: Readonly<Record<string, string>>,
    scheme?: Scheme,
  ): void;
  /** The core's theme.* (save, import, export, remove), as the studio's editor uses them. */
  io(): ThemeIo;
  /** The core's brain.ask and brain.status, as the studio's Describe uses them (ADR 0059). */
  brain(): ThemeBrain;
}

/** One question to the brain, answered through a tool, and whether the brain can be reached. */
export interface ThemeBrain {
  /**
   * Ask with `tool` (brain:ask); `hear` gets the turn's events (started, offline, online, completed,
   * error) and nothing of other turns, until it ends. Resolves to a function that stops hearing it.
   */
  ask(prompt: string, tool: BrainAskTool, hear: (turn: BrainTurnData) => void): Promise<() => void>;
  /** Which brain the desk has, or undefined when the core cannot say. */
  status(): Promise<BrainStatusResult | undefined>;
}

/** What the core does with themes (theme.*): the studio's save, export, import and remove. */
export interface ThemeIo {
  /** Save as a user theme; files the draft names but `files` lacks come from `copyFrom`'s folder. */
  save(
    theme: { id: string; name: string; description?: string; theme: ThemePackage },
    files: ReadonlyArray<{ path: string; base64: string }>,
    copyFrom?: string,
  ): Promise<void>;
  exportTheme(id: string): Promise<string>;
  importBundle(bundle: unknown): Promise<string>;
  remove(id: string): Promise<void>;
}

/** The id a draft is previewed under. */
export const DRAFT_THEME = "local.draft";

/** Where the desk serves a plugin's file: the runtime's plugin URL, or a relative one. */
export type PluginUrl = (id: string, path: string, revision: number) => string;

/** `target` takes the tokens and data-scheme: the desk's root unless a host gives its own. */
export function installTheme(
  ctx: DeskContext,
  target: HTMLElement = ctx.root,
  url: PluginUrl = (id, path) => `/${id}/${path}`,
): ThemePolicy {
  const { hub, win } = ctx;
  const { settings, commands } = hub;
  const media = mediaPreferences(win);
  const offs = disposer();
  const read = (): ThemeSettings => ({
    scheme: settings.get("desk.theme.scheme", DEFAULT_THEME_SETTINGS.scheme),
    contrast: settings.get("desk.theme.contrast", DEFAULT_THEME_SETTINGS.contrast),
    motion: settings.get("desk.theme.motion", DEFAULT_THEME_SETTINGS.motion),
    active: settings.get("desk.theme.active", DEFAULT_THEME_SETTINGS.active),
  });
  const installed = (): InstalledTheme[] =>
    hub.policy.installedThemes.map(({ revision, ...theme }) => ({
      ...theme,
      url: (path: string) => url(theme.id, path, revision),
    }));
  let previewed: string | undefined;
  let draft: InstalledTheme | undefined;
  let draftScheme: Scheme | undefined;
  const listeners = new Set<() => void>();
  const withDraft = () => (draft ? [...installed(), draft] : installed());
  const known = (id: string) => id === "" || withDraft().some((t) => t.id === id);
  const resolve = (id: string, scheme?: Scheme) =>
    resolveTheme(
      hub.policy.themes,
      { ...read(), active: id, ...(scheme ? { scheme } : {}) },
      media.read(),
      withDraft(),
    );
  let state = resolveTheme(hub.policy.themes, read(), media.read(), installed());

  const apply = () => {
    if (previewed !== undefined && !known(previewed)) previewed = undefined;
    state =
      previewed === undefined
        ? resolve(read().active ?? "")
        : resolve(previewed, previewed === DRAFT_THEME ? draftScheme : undefined);
    applyThemeState(target, state);
    applyThemeFonts(fontHost(target.ownerDocument), state.fonts);
    const { scheme, contrast, reducedMotion, variables, fonts } = state;
    ctx.share({ type: "desk:theme", theme: { scheme, contrast, reducedMotion, variables, fonts } });
    for (const listener of [...listeners]) listener();
  };

  offs.add(hub.onPolicy(apply));
  offs.add(settings.onChange((keys) => keys.some((k) => k.startsWith("desk.theme.")) && apply()));
  offs.add(media.onChange(apply));

  const define = (
    id: string,
    title: string,
    run: (args: unknown) => unknown,
    keywords: string[] = [],
  ) =>
    offs.add(
      commands.define(id, { title, keywords: ["theme", ...keywords], owner: "desk.theme", run }),
    );
  define(
    "desk.theme.toggle",
    "Switch between light and dark",
    () => {
      const next = state.scheme === "dark" ? "light" : "dark";
      settings.set("desk.theme.scheme", next);
      return next;
    },
    ["light", "dark"],
  );
  define("desk.theme.light", "Use the light theme", () =>
    settings.set("desk.theme.scheme", "light"),
  );
  define("desk.theme.dark", "Use the dark theme", () => settings.set("desk.theme.scheme", "dark"));
  define("desk.theme.system", "Follow the system's light or dark", () =>
    settings.set("desk.theme.scheme", "system"),
  );
  define(
    "desk.theme.contrast",
    "Turn high contrast on or off",
    () => settings.set("desk.theme.contrast", state.contrast === "high" ? "normal" : "high"),
    ["contrast", "accessibility"],
  );
  define(
    "desk.theme.use",
    "Use a theme",
    (args: unknown) => {
      const id = (args as { id?: unknown } | undefined)?.id;
      const next = typeof id === "string" && known(id) ? id : "";
      previewed = undefined;
      settings.set("desk.theme.active", next);
      return next;
    },
    ["appearance", "look"],
  );
  define("desk.theme.default", "Use the endue theme", () => settings.set("desk.theme.active", ""), [
    "appearance",
    "endue",
  ]);
  define(
    "desk.theme.motion",
    "Turn reduced motion on or off",
    () => settings.set("desk.theme.motion", state.reducedMotion ? "full" : "reduce"),
    ["motion", "animation", "accessibility"],
  );

  return {
    state: () => state,
    installed,
    active: () => read().active ?? "",
    preview(id) {
      const next = id !== undefined && known(id) ? id : undefined;
      if (next === previewed) return;
      previewed = next;
      apply();
    },
    previewing: () => previewed,
    apply(id, scheme) {
      previewed = undefined;
      if (scheme && resolve("").scheme !== scheme) settings.set("desk.theme.scheme", scheme);
      // A theme just saved or imported is chosen before plugin.list has caught up with it.
      const user = id.startsWith("local.") || id.startsWith("market.");
      const next = known(id) || user ? id : "";
      if (next === (read().active ?? "")) apply();
      else settings.set("desk.theme.active", next);
    },
    resolve,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    io: () => themeIo(ctx),
    brain: () => themeBrain(ctx),
    previewDraft(theme, files = {}, scheme) {
      draftScheme = theme ? scheme : undefined;
      if (!theme) {
        draft = undefined;
        if (previewed === DRAFT_THEME) previewed = undefined;
        apply();
        return;
      }
      draft = {
        id: DRAFT_THEME,
        name: "Draft",
        theme,
        // A path the editor has no file for yet is not served: it stays unresolved until a save.
        url: (path) => files[path] ?? `about:blank#${encodeURIComponent(path)}`,
      };
      previewed = DRAFT_THEME;
      apply();
    },
    dispose: offs.dispose,
  };
}

/** theme.* on the core, as the runtime (which holds theme:manage) calls them. */
function themeIo(ctx: DeskContext): ThemeIo {
  const scope = { permission: "theme:manage" } as const;
  return {
    async save(entry, files, copyFrom) {
      const manifest = {
        id: entry.id,
        name: entry.name,
        version: "1.0.0",
        kind: "theme" as const,
        ...(entry.description ? { description: entry.description } : {}),
        theme: entry.theme,
      };
      await ctx.bridge.call("theme.save", {
        manifest,
        ...(files.length > 0 ? { files: [...files] } : {}),
        ...(copyFrom ? { copyFrom } : {}),
        scope,
      });
    },
    async exportTheme(id) {
      const result = await ctx.bridge.call("theme.export", { theme: id, scope });
      return result.path ?? id;
    },
    async importBundle(bundle) {
      const result = await ctx.bridge.call("theme.import", {
        bundle: bundle as never,
        scope,
      });
      return result.plugin.id;
    },
    async remove(id) {
      await ctx.bridge.call("theme.remove", { theme: id, scope });
    },
  };
}

/** The most events a turn keeps while its ask waits for the answer that names it. */
const EARLY = 64;

/** brain.ask and brain.status on the core, as the runtime (which holds brain:ask) calls them. */
function themeBrain(ctx: DeskContext): ThemeBrain {
  return {
    async ask(prompt, tool, hear) {
      let turnId: string | undefined;
      let ended = false;
      const early: BrainTurnData[] = [];
      const deliver = (turn: BrainTurnData) => {
        if (ended) return;
        hear(turn);
        if (turn.kind === "completed" || turn.kind === "error") stop();
      };
      const off = ctx.bridge.onEvent((event) => {
        if (event.event !== "brain.turn") return;
        // An event can come before the answer names its turn: kept until then.
        if (turnId === undefined) {
          if (early.length < EARLY) early.push(event.data);
        } else if (event.data.turnId === turnId) deliver(event.data);
      });
      const stop = () => {
        ended = true;
        off();
      };
      try {
        const scope = { permission: "brain:ask" } as const;
        turnId = (await ctx.bridge.call("brain.ask", { prompt, tool, scope })).turnId;
      } catch (error) {
        stop();
        throw error;
      }
      for (const turn of early.splice(0)) if (turn.turnId === turnId) deliver(turn);
      return stop;
    },
    async status() {
      try {
        return await ctx.bridge.call("brain.status", { scope: { permission: "brain:converse" } });
      } catch {
        return undefined;
      }
    },
  };
}
