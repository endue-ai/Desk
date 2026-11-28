// The Knowledge plugin: the sessions Claude Code and Codex keep on this computer, read by the
// built-in connector desk.agent-sessions, drawn as a graph of the files, tickets, pull requests and
// branches they share, with notes and agent tools (ADR 0404). Only this file imports the SDK.
import { CommandFailed, defineUiPlugin, startWorker } from "@endue-ai/plugin-sdk";
import { defineElements } from "@endue-ai/ui";
import { startPlugin } from "./plugin.js";
import { createView } from "./view.js";

defineElements();

defineUiPlugin({
  async mount(ctx) {
    /** @type {ReturnType<typeof createView> | undefined} */
    let view;
    const app = startPlugin(
      ctx,
      { render: (screen) => view?.render(screen) },
      { startWorker, fail: (id, code, message) => new CommandFailed(id, code, message) },
    );
    view = createView(/** @type {HTMLElement} */ (document.getElementById("app")), app.actions);
    ctx.theme.on(() => view?.retheme());
    await app.start();
  },
});
