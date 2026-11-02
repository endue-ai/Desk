/**
 * What the desk knows about a proposed profile beyond its schema: the problems a schema cannot see
 * (plugins that are not installed, settings nobody declares or of the wrong kind, the shell's layout
 * out of shape), and what switching to it would change, for the ghost. The changes mirror
 * desk.profiles' switch: autoload plugins and the three it never turns off stay as they are, and what
 * an earlier switch turned off comes back unless this profile turns it off too.
 */
import type { PluginInfo, ProfileContribution, SettingContribution } from "@endue-ai/bridge";
import { LAYOUTS, MODE } from "../modes/profiles";
import { KEEP_ON } from "../policies/profiles";
import { fits, type Settings } from "../settings";
import type { GhostWindow, ProfileModel } from "./ghost";

type Node = Record<string, unknown>;
const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const DESKTOPS = ["1", "2", "3", "4"];
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

/** The shell's recipe (`desk.shell.mode`): desktops 1 to 4, each surface a plugin in the 1440x900 frame. */
function recipeProblems(recipe: Node, ids: Set<string>, at: string): string[] {
  const out: string[] = [];
  if (recipe.desktop !== undefined)
    out.push(...layoutProblems(recipe.desktop, ids, `${at}/desktop`));
  const { desktops } = recipe;
  if (desktops === undefined) return out;
  if (!isNode(desktops)) return [...out, `${at}/desktops: must be an object`];
  for (const [desktop, layout] of Object.entries(desktops)) {
    const here = `${at}/desktops/${desktop}`;
    if (DESKTOPS.includes(desktop)) out.push(...layoutProblems(layout, ids, here));
    else out.push(`${here}: desktops are 1 to 4`);
  }
  return out;
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
  const desktops = DESKTOPS.flatMap((d) => {
    const own = isNode(recipe.desktops) ? recipe.desktops[d] : undefined;
    const layout = isNode(own) ? own : isNode(recipe.desktop) ? recipe.desktop : {};
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
    return windows.length ? [{ desktop: Number(d), windows }] : [];
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
