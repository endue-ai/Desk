// The terminal plugin: the person's shell in a pseudo-terminal the core runs, on the public SDK and
// bridge API only, as a community plugin would. sessions.js holds the behaviour, commands.js answers
// the commands and view.js is the DOM.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { wireCommands } from "./commands.js";
import { decide } from "./keys.js";
import { createTerminals } from "./sessions.js";
import { DEFAULTS, platformOf } from "./shell.js";
import { THEME_VARIABLES, terminalOptions } from "./theme.js";
import { createView } from "./view.js";

/** The theme before the desk has sent one. */
const PLAIN = { scheme: "dark", contrast: "normal", reducedMotion: false, variables: {} };

/**
 * What the page says for the colours a theme left out: tokens.css's defaults, or the theme the desk
 * applied to this frame's root. Read only when the theme lacks one of xterm's variables.
 * @param {{ variables: Record<string, string> }} theme
 */
function pageColors(theme) {
  if (THEME_VARIABLES.every((name) => theme.variables[name])) return {};
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(
    THEME_VARIABLES.map((name) => [name, style.getPropertyValue(name).trim()]),
  );
}

defineUiPlugin({
  async mount(ctx) {
    const platform = platformOf(navigator.platform);
    /** @type {ReturnType<typeof createTerminals> | undefined} */
    let app;
    const settings = () => app?.settings() ?? DEFAULTS;
    const options = () => {
      const theme = ctx.theme.get() ?? PLAIN;
      return {
        ...terminalOptions(settings(), theme, pageColors(theme)),
        copyOnSelect: settings().copyOnSelect,
      };
    };
    const view = createView(
      document,
      {
        input: (id, data) => app?.input(id, data),
        resize: (id, cols, rows) => app?.resize(id, cols, rows),
        select: (id) => app?.show(id),
        activate: (id) => {
          app?.show(id);
          app?.focus(id);
        },
        close: (id) => app?.close(id),
        retitle: (id, title) => app?.retitle(id, title),
        bell: (id) => app?.bell(id),
        key: (press, hasSelection) =>
          decide(press, { platform, deskKeys: settings().keysToDesk, hasSelection }),
        osc: (id, code, data) => app?.osc(id, code, data),
        rename: (id, title) => app?.rename(id, title),
        move: (id, index) => app?.move(id, index),
        restart: (id) => app?.restart(id),
        attend: () => app?.attend(),
        session: (id) => app?.sessions().find((s) => s.id === id),
      },
      options(),
      {
        bridge: ctx.bridge,
        platform,
        pasteWarning: () => settings().pasteWarning,
        dnd: ctx.dnd,
      },
    );
    // The person looks at the terminal on screen while the page is visible and has the focus: what
    // happens there needs no desk notification (notices.js).
    const looking = () => document.visibilityState === "visible" && document.hasFocus();
    app = createTerminals(ctx, view, { platform, looking });
    wireCommands(ctx.commands, app);
    view.drops(ctx.dnd, app);
    ctx.commands.on("endue.terminal.find", () => view.find());
    ctx.theme.on(() => view.theme(options()));
    // A setting changed while the desk runs: the terminals take it at once (TERM-SET).
    ctx.settings.onChange(({ key, value }) => {
      app?.configure(key, value);
      view.theme(options());
    });
    await app.start();
    // The settings are read by now: the terminals take the font, cursor and scrollback they ask for.
    view.theme(options());
  },
});
