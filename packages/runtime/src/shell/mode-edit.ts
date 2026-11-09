/**
 * Renaming and deleting profiles from the switcher, through desk.profiles. Who made a profile decides
 * what may happen to it: a file the person saved shadows a plugin's profile of its id (ADR 0079), so
 * deleting that file restores the plugin's profile, and only the person's own profiles go for good.
 */
import { runGesture } from "../gesture";
import type { Mode } from "../modes/types";
import type { ShellCtx } from "./context";

/** A plugin's profile as it came, one the person saved over, or the person's own. */
export type ModeOrigin = "plugin" | "changed" | "own";

/** The longest profile name the switcher asks for, as for a desktop's name. */
export const MODE_NAME_LIMIT = 40;

export function originOf(ctx: ShellCtx, id: string): ModeOrigin {
  if (!ctx.runtime.profiles.saved().includes(id)) return "plugin";
  return ctx.runtime.policy().profiles.some((p) => p.id === id) ? "changed" : "own";
}

/** A name as it is kept: one line, trimmed, at most MODE_NAME_LIMIT characters. */
export function modeName(name: string): string {
  return [...name.replace(/\s+/g, " ").trim()].slice(0, MODE_NAME_LIMIT).join("").trim();
}

/** Where the desk goes when the profile in force is deleted: Default, the way home, else another. */
export function homeFor(modes: readonly Mode[], leaving: string): Mode | undefined {
  const others = modes.filter((m) => m.manifest.id !== "base" && m.manifest.id !== leaving);
  return others.find((m) => m.manifest.id === "default") ?? others[0];
}

/**
 * Save the profile under a new name as it is (its plugins and settings, not this setup), so the
 * profile in force and the layout moved under it stay as they are.
 */
export async function renameMode(ctx: ShellCtx, id: string, name: string): Promise<boolean> {
  const profile = ctx.runtime.profiles.list().find((p) => p.id === id);
  const next = modeName(name);
  if (!profile || !next || next === profile.name) return false;
  return runGesture(ctx.runtime, "desk.profiles.save", {
    ...profile,
    name: next,
    plugins: profile.plugins ?? {},
    settings: profile.settings ?? {},
  });
}

/**
 * Delete the person's own profile, or restore a plugin's profile they saved over. desk.profiles keeps
 * the person's profile in force, so the desk goes home first (windows the next profile does not place
 * go to the drawer, as on any switch).
 */
export async function removeMode(ctx: ShellCtx, id: string): Promise<boolean> {
  const origin = originOf(ctx, id);
  if (origin === "plugin") return false;
  const s = ctx.store.get();
  // A restored profile is named as its plugin names it.
  const name =
    (origin === "changed"
      ? ctx.runtime.policy().profiles.find((p) => p.id === id)?.name
      : s.modes.find((m) => m.manifest.id === id)?.manifest.name) ?? id;
  if (origin === "own" && id === s.modeId) {
    const home = homeFor(s.modes, id);
    if (!home) return false;
    if (!(await runGesture(ctx.runtime, "desk.profiles.switch", { id: home.manifest.id })))
      return false;
  }
  if (!(await runGesture(ctx.runtime, "desk.profiles.remove", { id }))) return false;
  ctx.runtime.notify({
    caller: "desk",
    title: ctx.tr(origin === "own" ? "modeRemoved" : "modeRestored", { name }),
    level: "success",
  });
  return true;
}
