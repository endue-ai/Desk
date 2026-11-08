/**
 * What the desk knows about a proposed profile beyond its schema: the problems a schema cannot see
 * (plugins that are not installed, settings nobody declares or of the wrong kind, the shell's layout
 * out of shape), and what switching to it would change, for the ghost. The changes mirror
 * desk.profiles' switch: autoload plugins and the three it never turns off stay as they are, and what
 * an earlier switch turned off comes back unless this profile turns it off too.
 */
import type { PluginInfo, ProfileContribution, SettingContribution } from "@endue-ai/bridge";
import { readRecipe } from "../desktops/migrate";
import { defaultDesktops, MAX_DESKTOPS, NAME_LIMIT } from "../desktops/model";
import { LAYOUTS, MODE } from "../modes/profiles";
import { KEEP_ON } from "../policies/profiles";
import { fits, type Settings } from "../settings";
import type { GhostWindow, ProfileModel } from "./ghost";

type Node = Record<string, unknown>;
const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);
/** Before ADR 0117 a recipe named its desktops by number: these four still load. */
const NUMBERED = ["1", "2", "3", "4"];
const article = (word: string) => (/^[aeiou]/.test(word) ? `an ${word}` : `a ${word}`);

export const nameOf = (plugin: PluginInfo) => plugin.manifest?.name ?? plugin.id;

/** Each problem as `<pointer>: <what>`; none when the desk can switch to it as it is. */
export function profileProblems(
  profile: ProfileContribution,
  installed: PluginInfo[],
  declared: Record<string, SettingContribution>,
): string[] {
  const ids = new Set(installed.map((p) => p.id));
  const out: string[] = [];
  const enabled = profile.plugins?.enabled ?? [];
  for (const list of ["enabled", "disabled"] as const)
    (profile.plugins?.[list] ?? []).forEach((id, i) => {
      if (!ids.has(id)) out.push(`/plugins/${list}/${i}: ${id} is not installed`);
      else if (list === "disabled" && enabled.includes(id))
        out.push(`/plugins/disabled/${i}: ${id} is turned on too`);
    });
  for (const [name, value] of Object.entries(profile.settings ?? {})) {
    const at = `/settings/${name}`;
    const setting = declared[name];
    if (!setting) out.push(`${at}: no plugin declares this setting`);
    else if (!fits(setting, value))
      out.push(
        `${at}: must be ${setting.choices ? `one of ${setting.choices.join(", ")}` : article(setting.kind)}`,
      );
    else if (name === MODE) out.push(...recipeProblems(value as Node, ids, at));
  }
  return out;
}

/**
 * The shell's recipe (`desk.shell.mode`): its desktops as a list (ADR 0117), each with an id, a name
 * and a layout whose surfaces are plugins in the 1440x900 frame; or, as before, layouts by number.
 */
function recipeProblems(recipe: Node, ids: Set<string>, at: string): string[] {
  const out: string[] = [];
  if (recipe.desktop !== undefined)
    out.push(...layoutProblems(recipe.desktop, ids, `${at}/desktop`));
  const { desktops } = recipe;
  if (desktops === undefined) return out;
  if (Array.isArray(desktops)) return [...out, ...listProblems(desktops, ids, `${at}/desktops`)];
  if (!isNode(desktops)) return [...out, `${at}/desktops: must be a list of desktops`];
  for (const [desktop, layout] of Object.entries(desktops)) {
    const here = `${at}/desktops/${desktop}`;
    if (NUMBERED.includes(desktop)) out.push(...layoutProblems(layout, ids, here));
    else out.push(`${here}: desktops by number are 1 to 4; give more as a list with ids and names`);
  }
  return out;
}

function listProblems(list: unknown[], ids: Set<string>, at: string): string[] {
  if (list.length === 0) return [`${at}: must have at least one desktop`];
  if (list.length > MAX_DESKTOPS) return [`${at}: at most ${MAX_DESKTOPS} desktops`];
  const seen = new Set<string>();
  return list.flatMap((entry, i) => {
    const here = `${at}/${i}`;
    if (!isNode(entry)) return [`${here}: must be an object with an id, a name and a layout`];
    const out: string[] = [];
    const { id, name, layout } = entry;
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(id))
      out.push(`${here}/id: must be a short id (lowercase letters, digits, -)`);
    else if (seen.has(id)) out.push(`${here}/id: ${id} is used twice`);
    else seen.add(id);
    if (typeof name !== "string" || !name.trim() || name.length > NAME_LIMIT)
      out.push(`${here}/name: must be a name of 1 to ${NAME_LIMIT} characters`);
    if (layout !== undefined) out.push(...layoutProblems(layout, ids, `${here}/layout`));
    return out;
  });
}

function layoutProblems(layout: unknown, ids: Set<string>, here: string): string[] {
  if (!isNode(layout)) return [`${here}: must be an object`];
  const { surfaces } = layout;
  if (surfaces === undefined) return [];
  if (!Array.isArray(surfaces)) return [`${here}/surfaces: must be an array`];
  return surfaces.flatMap((surface, i) => {
    const at = `${here}/surfaces/${i}`;
    if (!isNode(surface)) return [`${at}: must be an object`];
    const out: string[] = [];
    if (typeof surface.id !== "string" || !surface.id) out.push(`${at}/id: must be a string`);
    if (typeof surface.plugin !== "string") out.push(`${at}/plugin: must be a string`);
    else if (!ids.has(surface.plugin)) out.push(`${at}/plugin: ${surface.plugin} is not installed`);
    for (const key of ["x", "y", "w", "h"]) {
      const n = surface[key];
      if (typeof n !== "number" || !Number.isFinite(n)) out.push(`${at}/${key}: must be a number`);
    }
    if (surface.pinned !== undefined && typeof surface.pinned !== "boolean")
      out.push(`${at}/pinned: must be a boolean`);
    return out;
  });
}

export interface ModelInputs {
  /** Installed plugins that are ready and not autoload, in layer order. */
  installed: PluginInfo[];
  /** What earlier switches turned off (desk.profiles' `profiles.off`). */
  turnedOff: string[];
  settings: Pick<Settings, "get" | "layer">;
  declared: Record<string, SettingContribution>;
}

/** What switching to `profile` would do, for the ghost. */
export function profileModel(profile: ProfileContribution, inputs: ModelInputs): ProfileModel {
  const { installed, settings } = inputs;
  const state = new Map(installed.map((p) => [p.id, p.enabled]));
  const disabled = new Set(profile.plugins?.disabled ?? []);
  const on = new Set<string>();
  for (const id of inputs.turnedOff) if (!disabled.has(id) && state.get(id) === false) on.add(id);
  for (const id of profile.plugins?.enabled ?? []) if (state.get(id) === false) on.add(id);
  const off = new Set(
    [...disabled].filter((id) => state.get(id) === true && !KEEP_ON.has(id) && !on.has(id)),
  );
  const named = (ids: Set<string>) =>
    installed.filter((p) => ids.has(p.id)).map((p) => ({ id: p.id, name: nameOf(p) }));

  const names = new Map(installed.map((p) => [p.id, nameOf(p)]));
  const recipe = isNode(profile.settings?.[MODE]) ? (profile.settings?.[MODE] as Node) : {};
  const own = readRecipe(recipe.desktops);
  const desktops = (own.list ?? defaultDesktops()).flatMap((d, i) => {
    const mine = own.layouts[d.id] as Node | undefined;
    const layout = mine ?? (isNode(recipe.desktop) ? recipe.desktop : {});
    const surfaces = Array.isArray(layout.surfaces) ? (layout.surfaces as Node[]) : [];
    const windows: GhostWindow[] = surfaces.map((s) => ({
      id: String(s.id),
      plugin: String(s.plugin),
      title: names.get(String(s.plugin)) ?? String(s.plugin),
      x: Number(s.x),
      y: Number(s.y),
      w: Number(s.w),
      h: Number(s.h),
    }));
    return windows.length ? [{ desktop: i + 1, windows }] : [];
  });

  // The profile layer is replaced whole: a setting the last profile set falls back to init.yaml's.
  const session = settings.layer("session");
  const init = settings.layer("init");
  const proposed = profile.settings ?? {};
  const keys = new Set([...Object.keys(proposed), ...Object.keys(settings.layer("profile"))]);
  const changes = [...keys]
    .filter((name) => name !== MODE && name !== LAYOUTS)
    .sort()
    .flatMap((name) => {
      const from = settings.get(name);
      const to =
        name in session
          ? session[name]
          : name in proposed
            ? proposed[name]
            : name in init
              ? init[name]
              : inputs.declared[name]?.default;
      return JSON.stringify(from) === JSON.stringify(to) ? [] : [{ name, from, to }];
    });

  return {
    id: profile.id,
    name: profile.name,
    ...(profile.description ? { description: profile.description } : {}),
    desktops,
    on: named(on),
    off: named(off),
    same: installed.length - on.size - off.size,
    settings: changes,
  };
}
