// Browser: surf the web in a desk window. The public SDK and bridge API only, as a community
// plugin would: the page is a web view of the desk's (web.*, ADR 0216), drawn over this page's
// #page, and this page holds the toolbar. browser.js holds the behaviour, view.js the DOM,
// agent.js what the desk's assistant does in the page.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createAgent } from "./agent.js";
import { createBrowser } from "./browser.js";
import { createView } from "./view.js";

defineUiPlugin({
  async mount(ctx) {
    /** @type {ReturnType<typeof createBrowser> | undefined} */
    let app;
    const view = createView(document, {
      go: (typed) => void app?.go(typed),
      back: () => app?.back(),
      forward: () => app?.forward(),
      reload: () => app?.reload(),
      stop: () => app?.stop(),
      resized: () => void app?.place(),
    });
    app = createBrowser(
      {
        call: (method, params) => ctx.bridge.call(method, params),
        onEvent: (listener) => ctx.bridge.onEvent(listener),
        ask: (permission, reason) => ctx.perm.request(permission, reason),
        setting: (key) => ctx.settings.get(key),
        restored: ctx.surface.restored,
      },
      view,
    );
    ctx.surface.onUnload(() => app?.kept());
    // What the assistant does in the page (agent.js): each answers the page as it reads after.
    const agent = createAgent(
      {
        call: (method, params) => ctx.bridge.call(method, params),
        ask: (permission, reason) => ctx.perm.request(permission, reason),
      },
      app,
    );
    for (const name of Object.keys(agent))
      ctx.commands.on(`endue.browser.${name}`, (args, invocation) => agent[name](args, invocation));
    ctx.commands.on("endue.browser.stop", () => app?.stop());
    // The frame going away ends its view; the desk would close it with the window anyway.
    window.addEventListener("pagehide", () => app?.close());
    await app.start();
    if (app.kept().url === "") view.focusAddress();
  },
});
