/**
 * The person's profiles as files: `~/.desk/profiles/<id>.yaml`, the file name the id (ADR 0079).
 * desk.profiles.save writes them; the person may edit them. A file is read at start and again when it
 * changes on disk; one that does not parse or check is ignored with a notice naming its line, and the
 * last valid read of it (if any) stays. Profiles an older desk kept in the store move to files once.
 */
import type { BridgeClient, ProfileContribution, ProfileFile } from "@endue-ai/bridge";
import { checkProfileFile, deskYaml, readDeskYaml } from "../desk-yaml";
import type { NoticeInput } from "../notify";
import { DESK_DIR, type DeskFolder } from "./desk-folder";

export const PROFILES_DIR = `${DESK_DIR}/profiles`;
/** Where an older desk kept saved profiles, in the store. */
export const PROFILES_KEY = "profiles";
export const PROFILE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const HEADER = [
  "A desk profile (specs/init/v0/profile.schema.json): the plugins it turns on and off, and the",
  "settings in force while it is. The file name is the profile id. Desk wrote it when you saved the",
  "profile; edit it freely, Desk applies a change at once.",
].join("\n");

export interface ProfileFiles {
  /** Move the store's profiles to files (those without one), then forget them in the store. */
  migrate(): Promise<void>;
  /** Read every profile file. */
  load(): Promise<void>;
  /** The valid profiles, by file name. */
  saved(): ProfileContribution[];
  save(profile: ProfileContribution): Promise<void>;
  /** Hear the id of a profile whose file changed on disk (saved, edited or removed). */
  onChange(listener: (id: string) => void): () => void;
  dispose(): void;
}

export function profileFiles(
  bridge: BridgeClient,
  folder: DeskFolder,
  notify: (input: NoticeInput) => void,
): ProfileFiles {
  const profiles = new Map<string, ProfileContribution>();
  /** The text of each file as last read or written, so a change is applied once. */
  const texts = new Map<string, string>();
  const listeners = new Set<(id: string) => void>();
  let off: (() => void) | undefined;

  const pathOf = (id: string) => `${PROFILES_DIR}/${id}.yaml`;
  const problem = (name: string, body: string) =>
    notify({ caller: "desk", title: `profiles/${name} is not in force`, body, level: "warning" });

  /** Read one file into `profiles`; whether anything changed. */
  const read = async (name: string): Promise<boolean> => {
    const id = name.slice(0, -".yaml".length);
    if (!PROFILE_ID.test(id)) {
      problem(name, "The file name is the profile id: lowercase letters, digits, . _ and -.");
      return false;
    }
    const text = await folder.read(pathOf(id));
    if (text === texts.get(id)) return false;
    if (text === undefined) {
      texts.delete(id);
      return profiles.delete(id);
    }
    texts.set(id, text);
    const parsed = readDeskYaml(`profiles/${name}`, text, checkProfileFile);
    if (!parsed.ok) {
      problem(name, parsed.problem);
      return false;
    }
    profiles.set(id, fromFile(id, parsed.value));
    return true;
  };

  return {
    migrate: async () => {
      const stored = await bridge.call("store.get", { key: PROFILES_KEY }).catch(() => ({}));
      const value = (stored as { value?: unknown }).value;
      if (!Array.isArray(value)) return;
      const existing = new Set(await folder.list(PROFILES_DIR));
      for (const profile of value as ProfileContribution[]) {
        if (typeof profile?.id !== "string" || !PROFILE_ID.test(profile.id)) continue;
        if (existing.has(`${profile.id}.yaml`)) continue;
        await folder.write(pathOf(profile.id), deskYaml(toFile(profile), HEADER));
      }
      // Null is how the store forgets (desk.session.forget does the same).
      await bridge.call("store.set", { key: PROFILES_KEY, value: null });
    },
    load: async () => {
      for (const name of await folder.list(PROFILES_DIR))
        if (name.endsWith(".yaml") && !name.startsWith(".")) await read(name);
      off ??= folder.onChange((path) => {
        const name = path.startsWith(`${PROFILES_DIR}/`) ? path.slice(PROFILES_DIR.length + 1) : "";
        if (!name.endsWith(".yaml") || name.includes("/") || name.startsWith(".")) return;
        void read(name).then((changed) => {
          if (changed) for (const listener of [...listeners]) listener(name.slice(0, -5));
        });
      });
    },
    saved: () => [...profiles.values()],
    save: async (profile) => {
      const text = deskYaml(toFile(profile), HEADER);
      texts.set(profile.id, text);
      profiles.set(profile.id, profile);
      await folder.write(pathOf(profile.id), text);
    },
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => {
      off?.();
      listeners.clear();
    },
  };
}

/** What a profile file holds: the profile without its id (the file name). */
function toFile({ id: _id, ...profile }: ProfileContribution): ProfileFile {
  return profile;
}

function fromFile(id: string, file: ProfileFile): ProfileContribution {
  const { version: _version, name, ...rest } = file;
  return { id, name: name ?? id, ...rest };
}
