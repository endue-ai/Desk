/** Settings supplied by the core even when no policy plugins are installed. */
import type { KeyBinding, SettingContribution } from "@endue-ai/bridge";

export const PERSONAL_KEYS = "desk.keys.bindings";
export const CORE_SETTINGS: Record<string, SettingContribution> = {
  [PERSONAL_KEYS]: { kind: "array", default: [], description: "Personal keyboard shortcuts." },
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
};

const COMBO = /^((Mod|Meta|Control|Ctrl|Cmd|Alt|Option|Shift)\+)*([^+\s]+|\+)$/;
const COMMAND = /^$|^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
export function isBinding(value: unknown): value is KeyBinding {
  if (!value || typeof value !== "object") return false;
  const b = value as Partial<KeyBinding>;
  return (
    typeof b.key === "string" &&
    b.key.length <= 64 &&
    COMBO.test(b.key) &&
    typeof b.command === "string" &&
    b.command.length <= 128 &&
    COMMAND.test(b.command) &&
    (b.mac === undefined || (typeof b.mac === "string" && b.mac.length <= 64 && COMBO.test(b.mac)))
  );
}
