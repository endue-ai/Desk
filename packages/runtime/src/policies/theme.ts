/** desk.theme: resolve the theme from its settings and the OS, apply it, and share it with plugins. */
import {
  applyThemeState,
  DEFAULT_THEME_SETTINGS,
  mediaPreferences,
  resolveTheme,
  type ThemeSettings,
  type ThemeState,
} from "../theme";
import { type DeskContext, disposer, type Installed } from "./context";

export interface ThemePolicy extends Installed {
  state(): ThemeState;
}

export function installTheme(ctx: DeskContext): ThemePolicy {
  const { hub, root, win } = ctx;
  const { settings, commands } = hub;
  const media = mediaPreferences(win);
  const offs = disposer();
  const read = (): ThemeSettings => ({
    scheme: settings.get("desk.theme.scheme", DEFAULT_THEME_SETTINGS.scheme),
    contrast: settings.get("desk.theme.contrast", DEFAULT_THEME_SETTINGS.contrast),
    motion: settings.get("desk.theme.motion", DEFAULT_THEME_SETTINGS.motion),
  });
  let state = resolveTheme(hub.policy.themes, read(), media.read());

  const apply = () => {
    state = resolveTheme(hub.policy.themes, read(), media.read());
    applyThemeState(root, state);
    const { scheme, contrast, reducedMotion, variables } = state;
    ctx.share({ type: "desk:theme", theme: { scheme, contrast, reducedMotion, variables } });
  };

  offs.add(hub.onPolicy(apply));
  offs.add(settings.onChange((keys) => keys.some((k) => k.startsWith("desk.theme.")) && apply()));
  offs.add(media.onChange(apply));

  const define = (id: string, title: string, run: () => unknown, keywords: string[] = []) =>
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
    "desk.theme.motion",
    "Turn reduced motion on or off",
    () => settings.set("desk.theme.motion", state.reducedMotion ? "full" : "reduce"),
    ["motion", "animation", "accessibility"],
  );

  return {
    state: () => state,
    dispose: offs.dispose,
  };
}
