/**
 * Profiles as a kind Eris proposes (ADR 0073): a plugin set plus settings, `ProfileContribution` of
 * specs/plugin/v0 without its id, which the desk writes from the name (`quiet-night`, `-2` when a
 * profile has it). The desk checks it (`profile-model.ts`), shows it as a ghost of the layout and the
 * plugin set on the runtime's card, and applies it through desk.profiles' own commands: save, then
 * switch. Undo switches back to the profile in force before and removes it (desk.profiles.remove).
 * Where desk.profiles keeps saved profiles is its own business (#286 moves them to files).
 */
import type {
  BridgeClient,
  PluginInfo,
  ProfileContribution,
  SettingContribution,
} from "@endue-ai/bridge";
import { CORE_SETTINGS } from "../core/defaults";
import { OFF_KEY } from "../policies/profiles";
import { autoloads } from "../policy";
import type { Settings } from "../settings";
import type { AskTool } from "./asker";
import type { Card } from "./card";
import type { ProfileModel } from "./ghost";
import type { Applied, ProposalKind } from "./pipeline";
import { nameOf, profileModel, profileProblems } from "./profile-model";
import type { Schemas } from "./schema";
import { PROFILE, specSchemas } from "./specs";
import { slugOf } from "./view";

const PLUGINS = { permission: "plugin:manage" } as const;
const SCALAR = new Set(["boolean", "integer", "number", "string"]);

const GUIDE = [
  "A profile is a plugin set plus settings that Desk switches as one. plugins.enabled turns plugins",
  "on and plugins.disabled turns them off; a plugin named in neither keeps its state, except one an",
  "earlier profile turned off, which comes back: to keep a plugin off, name it in disabled. Turn the",
  "apps (kind ui) on and off and leave the desk's own (kind policy) as they are. settings take the",
  "setting names the desk lists, with values of their kind. To lay windows out, set",
  '"desk.shell.mode": {"desktops": {"1": {"surfaces": [{"id": "notes", "plugin": "endue.notes",',
  '"x": 120, "y": 200, "w": 520, "h": 480, "pinned": false}]}}}: desktops 1 to 4, in a 1440 by 900',
  "frame. Give it a short name; the desk makes its id from the name.",
].join(" ");

export interface ProfileKindOptions {
  bridge: BridgeClient;
  /** desk.profiles.list, .save, .switch and .remove, and desk.propose.undo, through the registry. */
  commands: { run(id: string, args?: unknown): Promise<unknown> };
  /** The settings in force and their layers. */
  settings: Pick<Settings, "get" | "layer">;
  /** The settings the plugins that are on declare; the core's own (ADR 0055) are added to them. */
  declared(): Record<string, SettingContribution>;
  card: Card;
  schemas?: Schemas;
}

interface Listed {
  active?: string;
  profiles: ProfileContribution[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function profileKind(options: ProfileKindOptions): ProposalKind<ProfileContribution> {
  const { bridge, commands, card } = options;
  // The core declares its settings with no plugin on, and its declaration wins, as in PolicyHub.
  const declared = () => ({ ...options.declared(), ...CORE_SETTINGS });
  let schemas: Schemas | undefined;
  let tool: AskTool | undefined;
  let compact: Record<string, unknown> | undefined;
  let last: { value: ProfileContribution; model: ProfileModel } | undefined;
  const specs = () => {
    schemas ??= options.schemas ?? specSchemas();
    return schemas;
  };
  const listed = async () => (await commands.run("desk.profiles.list")) as Listed;
  /** Installed plugins a profile can turn on and off: ready, and not autoload. */
  const installed = async (): Promise<PluginInfo[]> =>
    (await bridge.call("plugin.list", { scope: PLUGINS })).plugins.filter(
      (p) => p.status === "ready" && !autoloads(p),
    );
  const turnedOff = async () => {
    const stored = await bridge.call("store.get", { key: OFF_KEY }).catch(() => ({}));
    const value = (stored as { value?: unknown }).value;
    return Array.isArray(value) ? value.filter((p): p is string => typeof p === "string") : [];
  };
  const modelOf = async (value: ProfileContribution) => {
    const [plugins, off] = await Promise.all([installed(), turnedOff()]);
    const model = profileModel(value, {
      installed: plugins,
      turnedOff: off,
      settings: options.settings,
      declared: declared(),
    });
    last = { value, model };
    return model;
  };

  return {
    kind: "profile",
    noun: "profile",
    guide: GUIDE,
    tool() {
      tool ??= {
        name: "propose_profile",
        description:
          "Propose one Desk profile (ProfileContribution of specs/plugin/v0) as the person asked: its name, description, the plugins it turns on and off, and its settings. The desk makes its id.",
        schema: specs().bundle(PROFILE, { omit: ["id"] }),
      };
      return tool;
    },
    compact() {
      compact ??= specs().bundle(PROFILE, { compact: true, omit: ["id"] });
      return compact;
    },

    /** The plugins (name, kind, on or off), the scalar settings with their kinds, the profiles. */
    async context() {
      const [profiles, plugins] = await Promise.all([listed(), installed()]);
      const settings = Object.entries(declared())
        .filter(([, setting]) => SCALAR.has(setting.kind))
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([name, setting]) => [name, setting.choices ?? setting.kind]);
      return {
        plugins: Object.fromEntries(
          plugins.map((p) => [
            p.id,
            `${nameOf(p)}, ${p.manifest?.kind ?? "ui"}, ${p.enabled ? "on" : "off"}`,
          ]),
        ),
        settings: Object.fromEntries(settings),
        profiles: Object.fromEntries(profiles.profiles.map((p) => [p.id, p.name])),
        ...(profiles.active ? { active: profiles.active } : {}),
      };
    },

    async check(answer) {
      if (!isObject(answer)) return { problems: ["/: the answer is not a JSON object"] };
      const { id: _brains, ...rest } = answer;
      const [profiles, plugins] = await Promise.all([listed(), installed()]);
      const taken = new Set(profiles.profiles.map((p) => p.id));
      const base = slugOf(typeof rest.name === "string" ? rest.name : "", "profile");
      let id = base;
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
      const value = { id, ...rest } as unknown as ProfileContribution;
      const problems = specs().validate(value, PROFILE);
      if (problems.length === 0) problems.push(...profileProblems(value, plugins, declared()));
      return problems.length ? { problems } : { value };
    },

    async preview(value, request) {
      const model = await modelOf(value);
      return card.preview(
        { kind: "profile", title: value.name, model },
        `Eris made this from “${request.text}”.`,
      );
    },

    async dismiss() {
      card.close();
    },

    async apply(value): Promise<Applied> {
      const model = last?.value === value ? last.model : await modelOf(value);
      const before = await listed();
      const { id, name, description } = value;
      await commands.run("desk.profiles.save", {
        id,
        name,
        ...(description ? { description } : {}),
        plugins: value.plugins ?? {},
        settings: value.settings ?? {},
      });
      try {
        await commands.run("desk.profiles.switch", { id });
      } catch (error) {
        await commands.run("desk.profiles.remove", { id }).catch(() => {});
        throw error;
      }
      const back = before.profiles.find((p) => p.id === before.active)?.name;
      card.applied(
        { kind: "profile", title: name, model },
        `Eris made this profile and switched to it.${back ? ` Undo goes back to ${back}.` : ""}`,
        () => commands.run("desk.propose.undo", { kind: "profile", id }),
      );
      return {
        id,
        title: name,
        where: `profile ${id}`,
        line: `I made “${name}” and switched to it.`,
        before: before.active ?? "default",
      };
    },

    async undo({ id, before }) {
      const now = await listed();
      if (now.active === id) {
        const back = typeof before === "string" ? before : "default";
        await commands
          .run("desk.profiles.switch", { id: back })
          .catch(() => commands.run("desk.profiles.switch", { id: "default" }));
      }
      if (now.profiles.some((p) => p.id === id))
        await commands.run("desk.profiles.remove", { id }).catch((error: { message?: string }) => {
          if (!/not a saved profile/.test(error.message ?? "")) throw error;
        });
      card.close();
    },
  };
}
