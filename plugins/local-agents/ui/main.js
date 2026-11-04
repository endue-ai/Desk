// The Local agents plugin: the agent programs installed on this computer (Claude Code, Codex,
// Gemini CLI, Grok CLI and others), asked through their non-interactive modes, in five views: the
// agents found, a chat, answers compared side by side, a board of tasks and the activity. It uses
// only the public SDK and bridge API, exactly as a community plugin would.
import { CommandFailed, defineUiPlugin } from "@endue-ai/plugin-sdk";
import { defineElements } from "@endue-ai/ui";
import { startPlugin } from "./plugin.js";
import { createView } from "./view.js";

defineElements();

defineUiPlugin({
  mount(ctx) {
    /** @type {Record<string, (...args: unknown[]) => unknown>} */
    let actions = {};
    const view = createView(document, (action, ...args) => actions[action]?.(...args));
    const cancelled = (/** @type {string} */ message) =>
      new CommandFailed("endue.local-agents.ask", "cancelled", message);
    actions = startPlugin(ctx, view, { cancelled }).actions;
  },
});
