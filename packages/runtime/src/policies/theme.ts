/**
 * desk.theme: resolve the theme from its settings, the OS and the theme plugin desk.theme.active names,
 * apply it (tokens and fonts), and share it with plugins.
 */
import {
  applyThemeState,
  DEFAULT_THEME_SETTINGS,
  type InstalledTheme,
  mediaPreferences,
  resolveTheme,
  type ThemeSettings,
  type ThemeState,
} from "../theme";
import { applyThemeFonts, fontHost } from "../theme-fonts";
import { type DeskContext, disposer, type Installed } from "./context";

export interface ThemePolicy extends Installed {
  state(): ThemeState;
  /** The installed theme plugins, in layer order. */
  installed(): InstalledTheme[];
}

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
  let state = resolveTheme(hub.policy.themes, read(), media.read(), installed());

  const apply = () => {
    state = resolveTheme(hub.policy.themes, read(), media.read(), installed());
    applyThemeState(target, state);
    applyThemeFonts(fontHost(target.ownerDocument), state.fonts);
    const { scheme, contrast, reducedMotion, variables, fonts } = state;
    ctx.share({ type: "desk:theme", theme: { scheme, contrast, reducedMotion, variables, fonts } });
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
      const next = typeof id === "string" && installed().some((t) => t.id === id) ? id : "";
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
    dispose: offs.dispose,
  };
}
