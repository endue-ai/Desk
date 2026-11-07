/**
 * Roles (BR-05, ADR 0104): the desk's edges, its palette and its settings window are roles that a
 * plugin can fill by declaring them in `provides`. The `desk.roles` setting (role → plugin id)
 * chooses a role's provider; a role it does not name keeps its default, the desk's own part, and
 * every enabled plugin mounts as before. A role it names is that plugin's alone: the desk's own part
 * yields, other providers of the role do not mount, and a named provider that is turned off leaves
 * the role empty, so turning it off removes its edge.
 */
import type { PluginInfo } from "@endue-ai/bridge";

export const ROLES = [
  "role:rail",
  "role:agents",
  "role:dock",
  "role:palette",
  "role:settings-ui",
] as const;
export type Role = (typeof ROLES)[number];

/** The setting that names each role's provider. */
export const ROLES_SETTING = "desk.roles";

/** Who fills a role when the setting names nobody: the shell's parts, the palette, the runtime. */
export const DEFAULTS: Record<Role, string> = {
  "role:rail": "desk.shell",
  "role:agents": "desk.shell",
  "role:dock": "desk.shell",
  "role:palette": "desk.palette",
  "role:settings-ui": "desk",
};

type Chosen = Record<string, unknown>;
const isRole = (role: string): role is Role => (ROLES as readonly string[]).includes(role);

/** The roles a plugin declares it can fill. */
export const rolesOf = (info: Pick<PluginInfo, "manifest">): string[] => [
  ...(info.manifest?.provides ?? []),
];

/**
 * The plugin that fills `role` now: the one the setting names when it provides the role and is
 * enabled; null when the named one is off, missing or does not provide it; the default otherwise.
 */
export function providerOf(role: string, chosen: Chosen, plugins: PluginInfo[]): string | null {
  const named = chosen[role];
  const fallback = isRole(role) ? DEFAULTS[role] : null;
  if (typeof named !== "string" || named === fallback) return fallback;
  const plugin = plugins.find((p) => p.id === named);
  if (!plugin || !rolesOf(plugin).includes(role)) return null;
  return plugin.enabled && plugin.status === "ready" ? plugin.id : null;
}

/**
 * Whether a plugin's surface may mount: always, unless every role it provides is named in the
 * setting for another plugin.
 */
export function mayMount(info: PluginInfo, chosen: Chosen): boolean {
  const roles = rolesOf(info);
  if (roles.length === 0) return true;
  return roles.some((role) => typeof chosen[role] !== "string" || chosen[role] === info.id);
}

/** Whether the desk's own part (the shell's rail, agent bar or bottom edge) fills `role` now. */
export function ownsRole(role: Role, chosen: Chosen, own = DEFAULTS[role]): boolean {
  const named = chosen[role];
  return typeof named !== "string" || named === own;
}

/** The setting's value as role → plugin id, whatever was stored. */
export function chosenOf(value: unknown): Chosen {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Chosen) : {};
}
