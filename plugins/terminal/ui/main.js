// The terminal plugin: the person's shell in a pseudo-terminal the core runs, on the public SDK and
// bridge API only, as a community plugin would. sessions.js holds the behaviour, commands.js answers
// the commands and view.js is the DOM.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { wireCommands } from "./commands.js";
import { decide } from "./keys.js";
import { createTerminals } from "./sessions.js";
import { DEFAULTS, platformOf } from "./shell.js";
import { terminalOptions } from "./theme.js";
import { createView } from "./view.js";

/** The theme before the desk has sent one. */
const PLAIN = { scheme: "dark", contrast: "normal", reducedMotion: false, variables: {} };

defineUiPlugin({
  async mount(ctx) {
    const platform = platformOf(navigator.platform);
    /** @type {ReturnType<typeof createTerminals> | undefined} */
    let app;
    const settings = () => app?.settings() ?? DEFAULTS;
    const options = () => ({
      ...terminalOptions(settings(), ctx.theme.get() ?? PLAIN),
      copyOnSelect: settings().copyOnSelect,
    });
    const view = createView(
      document,
      {
        input: (id, data) => app?.input(id, data),
        resize: (id, cols, rows) => app?.resize(id, cols, rows),
        select: (id) => app?.show(id),
        close: (id) => app?.close(id),
        retitle: (id, title) => app?.retitle(id, title),
        bell: (id) => app?.bell(id),
        key: (press, hasSelection) =>
          decide(press, { platform, deskKeys: settings().keysToDesk, hasSelection }),
      },
      options(),
    );
    app = createTerminals(ctx, view, { platform });
    wireCommands(ctx.commands, app);
    ctx.theme.on(() => view.theme(options()));
    await app.start();
    // The settings are read by now: the terminals take the font, cursor and scrollback they ask for.
    view.theme(options());
  },
});
