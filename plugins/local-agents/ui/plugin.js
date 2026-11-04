// The plugin put together on a context and a view: the controller, the chat and compare, the
// board's work and the commands. main.js calls it with the DOM view; the tests with a recording one.

import { createApp } from "./agents.js";
import { wireCommands } from "./commands.js";
import { createTalk } from "./talk.js";
import { createTasks } from "./tasks.js";

/**
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginContext, "bridge" | "commands">} ctx
 * @param {import("./agents.js").View} view
 * @param {Parameters<typeof createApp>[2]} [options]
 */
export function startPlugin(ctx, view, options = {}) {
  const app = createApp(ctx, view, options);
  const talk = createTalk(app);
  const tasks = createTasks(app);
  const actions = wireCommands(ctx, app, talk, tasks);
  return { app, talk, tasks, actions };
}
