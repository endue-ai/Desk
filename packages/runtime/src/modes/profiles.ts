/**
 * A profile as the shell lays it out. desk.profiles holds the profiles (a plugin set plus settings);
 * the shell reads two of those settings: `desk.shell.mode`, what the profile lays out on desktops
 * 1–4 over the setting's default (the base every profile starts from), and `desk.shell.layouts`,
 * the desktops moved since it was saved.
 */
import type { ProfileContribution } from "@endue-ai/bridge";
import {
  DESKTOPS,
  type DesktopIndex,
  type DesktopLayout,
  type Mode,
  type ModeEris,
  type ModeManifest,
  type ModeRoles,
  type ModeTriggers,
} from "./types";

export const MODE = "desk.shell.mode";
export const LAYOUTS = "desk.shell.layouts";

/** What `desk.shell.mode` holds. Every field may be left to the base. */
export interface ShellRecipe {
  icon?: string;
  author?: string;
  version?: string;
  copiedFrom?: ModeManifest["copiedFrom"];
  /** The layout every desktop starts from. */
  desktop?: Partial<DesktopLayout>;
  /** Each desktop's own, by number. */
  desktops?: Partial<Record<string, Partial<DesktopLayout>>>;
  roles?: ModeRoles["roles"];
  eris?: ModeEris;
  triggers?: ModeTriggers;
}

const ERIS: ModeEris = {
  scope: { folders: [], calendar: false, mail: false, mic: "off" },
  manner: { interrupt: "attention-only", voice: false, greeting: "" },
};

const asRecipe = (value: unknown): ShellRecipe =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as ShellRecipe) : {};

function desktopsOf(
  recipe: ShellRecipe,
  layouts: Partial<Record<string, DesktopLayout>> = {},
): Mode["desktops"] {
  const out: Mode["desktops"] = {};
  for (const d of DESKTOPS) {
    const layout = layouts[d] ?? recipe.desktops?.[d];
    if (layout) out[d] = structuredClone(layout);
  }
  return out;
}

/** The base: what `desk.shell.mode` says before any profile sets it. */
export function baseMode(value: unknown): Mode {
  const recipe = asRecipe(value);
  return {
    manifest: {
      id: "base",
      name: "Base",
      icon: recipe.icon ?? "sparkle",
      author: recipe.author ?? "endue",
      version: recipe.version ?? "1.0.0",
      extends: null,
    },
    lays: true,
    desktop: recipe.desktop,
    desktops: desktopsOf(recipe),
    roles: { roles: recipe.roles ?? [] },
    eris: recipe.eris ?? ERIS,
    triggers: recipe.triggers ?? { manual: true },
  };
}

/** A profile over the base: its recipe's fields where it has them, its saved layouts over its desktops. */
export function profileMode(profile: ProfileContribution, base: Mode): Mode {
  const recipe = asRecipe(profile.settings?.[MODE]);
  const layouts = profile.settings?.[LAYOUTS] as Partial<Record<string, DesktopLayout>> | undefined;
  return {
    manifest: {
      id: profile.id,
      name: profile.name,
      icon: recipe.icon ?? base.manifest.icon,
      author: recipe.author ?? base.manifest.author,
      version: recipe.version ?? base.manifest.version,
      extends: "base",
      ...(recipe.copiedFrom ? { copiedFrom: recipe.copiedFrom } : {}),
    },
    lays: profile.settings?.[MODE] !== undefined,
    desktop: recipe.desktop,
    desktops: desktopsOf(recipe, layouts),
    roles: recipe.roles ? { roles: recipe.roles } : base.roles,
    eris: recipe.eris ?? base.eris,
    triggers: recipe.triggers ?? base.triggers,
  };
}

/** The recipe that lays a mode out again: what saving a profile writes into `desk.shell.mode`. */
export function recipeOf(mode: Mode): ShellRecipe {
  const { icon, author, version, copiedFrom } = mode.manifest;
  const desktops: Record<string, Partial<DesktopLayout>> = {};
  for (const d of DESKTOPS) {
    const layout = mode.desktops[d as DesktopIndex];
    if (layout) desktops[d] = structuredClone(layout);
  }
  return {
    icon,
    author,
    version,
    ...(copiedFrom ? { copiedFrom } : {}),
    ...(mode.desktop ? { desktop: structuredClone(mode.desktop) } : {}),
    desktops,
    roles: mode.roles.roles,
    eris: mode.eris,
    triggers: mode.triggers,
  };
}
