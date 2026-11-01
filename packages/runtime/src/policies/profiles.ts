/**
 * desk.profiles (init.el, switched while Desk runs): a profile is a plugin set plus settings. The
 * one init.yaml names applies at start; switching applies another: its settings layer over
 * init.yaml's and its plugins turn on and off. People save their own with desk.profiles.save.
 */
import type { ProfileContribution } from "@endue-ai/bridge";
import { CommandError } from "../commands";
import type { NoticeInput } from "../notify";
import { type DeskContext, disposer, type Installed } from "./context";

export const PROFILES_KEY = "profiles";
/** Never turned off by a profile: there would be no way back. */
const KEEP_ON = new Set(["desk.profiles", "desk.palette"]);

export interface ProfilesPolicy extends Installed {
  /** The profile in force, or undefined before the first is applied. */
  active(): string | undefined;
  /** Contributed profiles, then saved ones; a saved profile replaces a contributed one of its id. */
  list(): ProfileContribution[];
  /** Hear every switch and save (the shell's profile switcher listens). */
  onChange(listener: () => void): () => void;
  /** Read the saved profiles and apply init.yaml's (once, after the plugins are listed). */
  start(): Promise<void>;
}

export function installProfiles(
  ctx: DeskContext,
  notify: (input: NoticeInput) => void,
): ProfilesPolicy {
  const { hub, bridge } = ctx;
  const { commands, settings } = hub;
  const offs = disposer();
  let saved: ProfileContribution[] = [];
  let active: string | undefined;
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of [...listeners]) listener();
  };

  /** Contributed profiles, then saved ones; a saved profile replaces a contributed one of its id. */
  const all = (): ProfileContribution[] => {
    const byId = new Map<string, ProfileContribution>();
    for (const { owner: _owner, ...profile } of hub.policy.profiles) byId.set(profile.id, profile);
    for (const profile of saved) byId.set(profile.id, profile);
    return [...byId.values()];
  };

  const setEnabled = (plugin: string, enabled: boolean) =>
    bridge
      .call("plugin.setEnabled", { plugin, enabled, scope: { permission: "plugin:manage" } })
      .catch(() => undefined);

  const apply = async (id: string, quiet = false) => {
    const profile = all().find((p) => p.id === id);
    if (!profile) throw new CommandError("failed", `no profile ${id}`);
    active = id;
    // Before the settings: a profile that turns on do-not-disturb still says it is in force.
    if (!quiet) notify({ caller: "desk", title: `Profile: ${profile.name}`, level: "info" });
    settings.setLayer("profile", profile.settings ?? {});
    const installed = new Map(hub.plugins.map((p) => [p.id, p.enabled]));
    for (const plugin of profile.plugins?.enabled ?? []) {
      if (installed.get(plugin) === false) await setEnabled(plugin, true);
    }
    for (const plugin of profile.plugins?.disabled ?? []) {
      if (installed.get(plugin) === true && !KEEP_ON.has(plugin)) await setEnabled(plugin, false);
    }
    changed();
    return id;
  };

  const pick = async (title: string, free: boolean) => {
    if (!commands.has("desk.palette.pick")) return undefined;
    const items = all().map((p) => ({
      id: p.id,
      label: p.name,
      detail: p.id === active ? "in force" : (p.description ?? ""),
    }));
    const answer = await commands
      .run("desk.palette.pick", { title, items, free, placeholder: free ? "a new name" : "" })
      .catch(() => undefined);
    return typeof answer === "string" ? answer : undefined;
  };

  const define = (id: string, title: string, run: (args: unknown) => unknown, keywords: string[]) =>
    offs.add(
      commands.define(id, {
        title,
        keywords: ["profiles", ...keywords],
        owner: "desk.profiles",
        run,
      }),
    );
  const idOf = (args: unknown) => (args as { id?: string } | undefined)?.id;

  define(
    "desk.profiles.switch",
    "Switch to another profile",
    async (args) => {
      const id = idOf(args) ?? (await pick("Switch to a profile", false));
      return id ? apply(id) : null;
    },
    ["mode"],
  );
  define("desk.profiles.list", "List profiles", () => ({ active, profiles: all() }), []);
  define(
    "desk.profiles.save",
    "Save this setup as a profile",
    async (args) => {
      // `settings` and `plugins` save that profile as given (a copy of another) instead of this setup.
      const { id: given, name, ...rest } = (args ?? {}) as Partial<ProfileContribution>;
      const id = given ?? (await pick("Save this setup as", true));
      if (!id) return null;
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id))
        throw new CommandError("failed", `${id} is not a profile name (lowercase, digits, . _ -)`);
      const plugins = hub.plugins.filter((p) => p.status === "ready");
      const profile: ProfileContribution = {
        id,
        name: name ?? all().find((p) => p.id === id)?.name ?? id,
        plugins: rest.plugins ?? {
          enabled: plugins.filter((p) => p.enabled).map((p) => p.id),
          disabled: plugins.filter((p) => !p.enabled).map((p) => p.id),
        },
        settings: rest.settings ?? { ...settings.layer("profile"), ...settings.layer("session") },
      };
      saved = [...saved.filter((p) => p.id !== id), profile];
      await bridge.call("store.set", { key: PROFILES_KEY, value: saved });
      // A copy is saved beside the profile in force; saving this setup makes it the one in force,
      // and its changes move from the session into the profile (the values in force stay the same).
      if (!rest.settings) {
        active = id;
        settings.setLayer("profile", profile.settings ?? {});
        settings.setLayer("session", {});
      }
      changed();
      notify({ caller: "desk", title: `Saved profile ${profile.name}`, level: "success" });
      return profile;
    },
    ["mode", "init"],
  );

  return {
    active: () => active,
    list: all,
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: async () => {
      if (!hub.enabled("desk.profiles")) return;
      const stored = await bridge.call("store.get", { key: PROFILES_KEY }).catch(() => ({}));
      const value = (stored as { value?: unknown }).value;
      if (Array.isArray(value)) saved = value as ProfileContribution[];
      changed();
      const start = hub.startProfile;
      if (all().some((p) => p.id === start)) await apply(start, true);
      else
        notify({
          caller: "desk",
          title: `No profile ${start}`,
          body: "init.yaml names it.",
          level: "warning",
        });
    },
    dispose: offs.dispose,
  };
}
