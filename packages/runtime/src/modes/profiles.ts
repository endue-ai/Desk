/**
 * A profile as the shell lays it out. desk.profiles holds the profiles (a plugin set plus settings);
 * the shell reads two of those settings: `desk.shell.mode`, its desktops and what it lays out on each
 * over the setting's default (the base every profile starts from), and `desk.shell.layouts`, the
 * desktops changed since it was saved. Both keep desktops as a list (ADR 0117, `desktops/migrate.ts`);
 * what the four-desktop desk saved, by desktop number, loads as the four named 1 to 4.
 */
import type { ProfileContribution } from "@endue-ai/bridge";
import { readMoved, readRecipe, type StoredDesktop, writeList } from "../desktops/migrate";
import { defaultDesktops } from "../desktops/model";
import type { DesktopLayout, Mode, ModeEris, ModeManifest, ModeRoles, ModeTriggers } from "./types";

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
  /**
   * Its desktops in order, each with its id, name and layout over `desktop`; before ADR 0117, each
   * desktop's layout by number (1 to 4), which still loads.
   */
  desktops?: StoredDesktop[] | Partial<Record<string, Partial<DesktopLayout>>>;
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

/** The desktops a recipe names (else `fallback`) and their layouts, its saved moves over them. */
function desktopsOf(
  recipe: ShellRecipe,
  fallback: Mode["list"],
  moves?: unknown,
): Pick<Mode, "list" | "desktops"> {
  const own = readRecipe(recipe.desktops);
  const moved = readMoved(moves);
  const list = (moved.list ?? own.list ?? fallback).map((d) => ({ ...d }));
  const desktops: Mode["desktops"] = {};
  for (const { id } of list) {
    const layout = moved.layouts[id] ?? own.layouts[id];
    if (layout) desktops[id] = layout;
  }
  return { list, desktops };
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
    ...desktopsOf(recipe, defaultDesktops()),
    roles: { roles: recipe.roles ?? [] },
    eris: recipe.eris ?? ERIS,
    triggers: recipe.triggers ?? { manual: true },
  };
}

/**
 * A profile over the base: its recipe's fields where it has them, its desktops (the base's when it
 * names none) and its saved moves over them.
 */
export function profileMode(profile: ProfileContribution, base: Mode): Mode {
  const recipe = asRecipe(profile.settings?.[MODE]);
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
    ...desktopsOf(recipe, base.list, profile.settings?.[LAYOUTS]),
    roles: recipe.roles ? { roles: recipe.roles } : base.roles,
    eris: recipe.eris ?? base.eris,
    triggers: recipe.triggers ?? base.triggers,
  };
}

/** The recipe that lays a mode out again: what saving a profile writes into `desk.shell.mode`. */
export function recipeOf(mode: Mode): ShellRecipe & { desktops: StoredDesktop[] } {
  const { icon, author, version, copiedFrom } = mode.manifest;
  return {
    icon,
    author,
    version,
    ...(copiedFrom ? { copiedFrom } : {}),
    ...(mode.desktop ? { desktop: structuredClone(mode.desktop) } : {}),
    desktops: writeList(mode.list, mode.desktops),
    roles: mode.roles.roles,
    eris: mode.eris,
    triggers: mode.triggers,
  };
}
