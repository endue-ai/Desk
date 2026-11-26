/**
 * What the runtime's own commands tell agents when they are offered as tools (ADR 0088): the words
 * and schemas a brain reads. Eris opens the plugin a request needs with desk.plugins.open (ADR 0109).
 */
import type { AgentSpec } from "./commands";

export const OPEN_PLUGIN: AgentSpec = {
  description:
    "Open a plugin's window and give it the focus: the window that shows it, else the one in the drawer, else a new one. A plugin the person turned off is turned on. A data-only plugin, such as desk.today or desk.fleet, opens what its own open command shows; one with nothing to show answers that it has no window. Use it when the person asks to open, show or switch to a plugin, or before working in one they cannot see; plugin is its id, as the desk's windows name it.",
  args: {
    type: "object",
    properties: {
      plugin: { type: "string", description: "The plugin's id, for example endue.git." },
      waitForReady: { type: "boolean", description: "Answer once the plugin has started." },
      another: {
        type: "boolean",
        description:
          "Open one more window of a plugin that has several (its manifest says instances: many) and answer its id; any other plugin refuses.",
      },
    },
    additionalProperties: false,
  },
};

const NAME = { type: "string", minLength: 1 };
const objectArgs = (properties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});
const idArgs = objectArgs({ id: NAME }, ["id"]);

export const SETTINGS_TOOLS = {
  get: {
    description:
      "Read one declared setting by its full key, such as desk.notify.info-ms, or list settings by prefix. Each entry shows the value, default and layer in force (session, profile, init or default).",
    args: {
      ...objectArgs({ key: NAME, prefix: { type: "string" } }),
      not: { required: ["key", "prefix"] },
    },
    readOnly: true,
  },
  set: {
    description:
      "Set a declared preference by its full key and JSON value. The value must fit the setting's declaration. Trust, execution and safety settings can be changed in the settings UI.",
    args: objectArgs({ key: NAME, value: {} }, ["key", "value"]),
  },
} satisfies Record<string, AgentSpec>;

export const THEME_TOOLS = {
  list: {
    description:
      "List installed themes and the theme in force. The empty ID is the built-in endue theme.",
    args: objectArgs(),
    readOnly: true,
  },
  use: {
    description:
      "Choose an installed theme by the ID from desk.theme.list. Use the empty ID for the endue theme.",
    args: objectArgs({ id: { type: "string" } }),
  },
  set: {
    description:
      "Set the light or dark scheme, contrast or motion. Omitted choices stay as they are.",
    args: objectArgs({
      scheme: { type: "string", enum: ["light", "dark", "system"] },
      contrast: { type: "string", enum: ["normal", "high", "system"] },
      motion: { type: "string", enum: ["reduce", "full", "system"] },
    }),
  },
} satisfies Record<string, AgentSpec>;

export const NOTIFY_TOOLS = {
  history: {
    description: "Read recent desk notifications with their IDs and text in newest-first order.",
    args: objectArgs({ show: { type: "boolean" } }),
    readOnly: true,
  },
  dnd: {
    description: "Set do not disturb on or off. Set on to true to hold notifications back.",
    args: objectArgs({ on: { type: "boolean" } }),
  },
  dismiss: {
    description:
      "Dismiss the notification with the given ID from the status line or its queue. Its history entry stays.",
    args: objectArgs({ id: NAME }),
  },
  clear: {
    description: "Erase the desk's entire notification history. The person approves the operation.",
    args: objectArgs(),
    irreversible: true,
  },
} satisfies Record<string, AgentSpec>;

export const PROFILE_TOOLS = {
  list: {
    description: "List profile IDs and names and the profile currently in force.",
    args: objectArgs(),
    readOnly: true,
  },
  switch: {
    description: "Switch to an existing profile by the ID from desk.profiles.list.",
    args: objectArgs({ id: NAME }),
  },
  save: {
    description:
      "Save the active settings and plugin setup under a new profile ID and display name.",
    args: { ...objectArgs({ id: NAME, name: NAME }), additionalProperties: true },
  },
  remove: {
    description: "Remove a saved profile by its ID. The person approves the operation.",
    args: idArgs,
    irreversible: true,
  },
} satisfies Record<string, AgentSpec>;
