/**
 * desk.keys keeps the person's own bindings in `~/.desk/keys.yaml` (ADR 0079): the file is read at
 * start into the session layer of `desk.keys.bindings`, over a profile's and init.yaml's, as the
 * session record used to put them back; a rebinding writes it; a hand edit applies at once. A file
 * that does not parse or check is ignored with a notice naming its line and is never overwritten:
 * changes made meanwhile last until Desk quits. Bindings an older desk kept in the session record
 * (`parts.keys`) move to the file once.
 */
import type { KeyBinding, KeysFile } from "@endue-ai/bridge";
import { checkKeysFile, deskYaml, readDeskYaml } from "../desk-yaml";
import type { NoticeInput } from "../notify";
import { type DeskContext, disposer, type Installed } from "./context";
import { DESK_DIR, type DeskFolder, deskFolder } from "./desk-folder";
import { PERSONAL_KEYS } from "./keys";
import { SESSION_KEY } from "./session";

export const KEYS_FILE = `${DESK_DIR}/keys.yaml`;

const HEADER = [
  "Your key bindings (specs/init/v0/keys.schema.json), over every plugin's: a later binding of the",
  'same key wins, and command: "" takes a key away. Desk writes this file when you rebind a key;',
  "edit it freely, Desk applies a change at once.",
].join("\n");

export interface KeysFilePolicy extends Installed {
  /** Move the session record's bindings to the file, read it, and follow it (once, at start). */
  start(): Promise<void>;
}

export function installKeysFile(
  ctx: DeskContext,
  notify: (input: NoticeInput) => void,
  folder: DeskFolder = deskFolder(ctx.bridge),
): KeysFilePolicy {
  const { hub, bridge } = ctx;
  const { settings } = hub;
  const offs = disposer();
  /** The file's text as last read or written; undefined when there is none. */
  let text: string | undefined;
  /** Whether the file as last read was valid (or absent): only then may the desk write it. */
  let valid = true;
  /** Set while the file's bindings go into the settings, so they are not written back. */
  let applying = false;
  /** The session layer's bindings as the file last had them; null before start reads it. */
  let held: string | null = null;
  const session = () => JSON.stringify(settings.layer("session")[PERSONAL_KEYS] ?? []);

  const apply = (next: string | undefined) => {
    if (next === text) return;
    text = next;
    if (next === undefined) {
      valid = true;
      applying = true;
      settings.reset(PERSONAL_KEYS);
      applying = false;
      held = session();
      return;
    }
    const read = readDeskYaml("keys.yaml", next, checkKeysFile);
    valid = read.ok;
    if (!read.ok) {
      notify({
        caller: "desk",
        title: "keys.yaml is not in force",
        body: read.problem,
        level: "warning",
      });
      return;
    }
    applying = true;
    settings.set(PERSONAL_KEYS, read.value.bindings ?? []);
    applying = false;
    held = session();
  };

  const write = (bindings: KeyBinding[]) => {
    const next = deskYaml({ bindings } satisfies KeysFile, HEADER);
    if (next === text) return;
    text = next;
    void folder.write(KEYS_FILE, next).catch((error: unknown) =>
      notify({
        caller: "desk",
        title: "keys.yaml was not saved",
        body: String(error),
        level: "warning",
      }),
    );
  };

  /** Bindings an older desk kept in the session record: to the file (unless there is one), once. */
  const migrate = async () => {
    const stored = await bridge.call("store.get", { key: SESSION_KEY }).catch(() => ({}));
    const record = (stored as { value?: unknown }).value as {
      parts?: Record<string, unknown>;
    } | null;
    const parts = record?.parts;
    if (!parts || !("keys" in parts)) return;
    const { keys, ...rest } = parts;
    if (Array.isArray(keys) && (await folder.read(KEYS_FILE)) === undefined)
      await folder.write(KEYS_FILE, deskYaml({ bindings: keys }, HEADER));
    await bridge.call("store.set", { key: SESSION_KEY, value: { ...record, parts: rest } });
  };

  offs.add(
    settings.onChange((keys) => {
      // Only the person's own changes count: not the file read back, not a default or a profile
      // arriving (before start, the file has not been read yet and must not be written over).
      if (applying || held === null || !keys.includes(PERSONAL_KEYS) || session() === held) return;
      held = session();
      const value = settings.layer("session")[PERSONAL_KEYS];
      if (!valid) {
        notify({
          caller: "desk",
          title: "keys.yaml is not in force",
          body: "Fix the file to keep this change: until then it lasts until Desk quits.",
          level: "warning",
        });
        return;
      }
      write(Array.isArray(value) ? (value as KeyBinding[]) : []);
    }),
  );

  return {
    start: async () => {
      await migrate().catch(() => {});
      offs.add(
        folder.onChange((path) => {
          if (path === KEYS_FILE) void folder.read(KEYS_FILE).then(apply);
        }),
      );
      apply(await folder.read(KEYS_FILE));
      held ??= session();
    },
    dispose: offs.dispose,
  };
}
