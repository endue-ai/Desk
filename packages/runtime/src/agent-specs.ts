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
    },
    additionalProperties: false,
  },
};
