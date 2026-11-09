/** Settings supplied by the core even when no policy plugins are installed. */
import type { KeyBinding, SettingContribution } from "@endue-ai/bridge";
import { isSequence } from "../sequences/parse";

export const PERSONAL_KEYS = "desk.keys.bindings";
/** How long a pending prefix waits for the next key (ADR 0118). */
export const SEQUENCE_TIMEOUT = "desk.keys.sequence-timeout";
/** How many plugin windows out of sight keep a live frame: the live budget (ADR 0134). */
export const LIVE_SURFACES = "desk.surfaces.live";
export const CORE_SETTINGS: Record<string, SettingContribution> = {
  [PERSONAL_KEYS]: {
    kind: "array",
    default: [],
    description:
      'Personal bindings over the core and plugin keys: { key, command }, and "command": "" takes a key away. A key is one chord or a sequence of chords (Ctrl+X Ctrl+F). The keyboard settings write them; desk.keys keeps them in ~/.desk/keys.yaml.',
  },
  [SEQUENCE_TIMEOUT]: {
    kind: "integer",
    default: 0,
    minimum: 0,
    maximum: 10000,
    description:
      "How long a pending prefix (Mod+K of Mod+K Mod+S) waits for the next key, in milliseconds. 0 waits as long as it takes, as Emacs does; Escape or Ctrl+G cancels.",
  },
  "desk.theme.scheme": {
    kind: "string",
    default: "dark",
    choices: ["system", "light", "dark"],
  },
  "desk.theme.contrast": {
    kind: "string",
    default: "system",
    choices: ["system", "normal", "high"],
  },
  "desk.theme.motion": {
    kind: "string",
    default: "system",
    choices: ["system", "reduce", "full"],
  },
  "desk.notify.dnd": { kind: "boolean", default: false },
  "desk.wallpaper.scene": {
    kind: "string",
    default: "theme",
    choices: ["theme", "grid", "pond", "aurora"],
    description: "The desk's wallpaper: theme, grid, a live pond or a live aurora.",
  },
  [LIVE_SURFACES]: {
    kind: "integer",
    default: 8,
    minimum: 0,
    description:
      "How many plugin windows out of sight keep a live frame: the ones focused most recently. The others sleep with their state kept and load again when shown or focused. Windows in sight, edge bars and overlays always keep theirs; 0 keeps only the windows in sight.",
  },
};

const COMMAND = /^$|^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
export function isBinding(value: unknown): value is KeyBinding {
  if (!value || typeof value !== "object") return false;
  const b = value as Partial<KeyBinding>;
  return (
    isSequence(b.key) &&
    typeof b.command === "string" &&
    b.command.length <= 128 &&
    COMMAND.test(b.command) &&
    (b.mac === undefined || isSequence(b.mac))
  );
}
