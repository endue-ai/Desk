// The Network plugin: who is on the network this computer is on, how safe it is and why it is slow,
// on one surface with four tabs. It uses only the public SDK and bridge API, exactly as a community
// plugin would; the desk's universal timeline draws its log.
import "@endue-ai/ui";
import { CommandFailed, defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createApp, INTERVAL_KEY } from "./app.js";
import { wireCommands } from "./commands.js";
import { loadOui } from "./oui.js";
import { createRunner } from "./run.js";
import { createStore } from "./store.js";
import { createView } from "./view.js";

/** "mac", "windows", "linux" or "other", from what the page's engine says it runs on. */
export function platformOf(/** @type {Navigator} */ nav) {
  const said =
    /** @type {any} */ (nav).userAgentData?.platform ?? nav.platform ?? nav.userAgent ?? "";
  if (/mac/i.test(said)) return "mac";
  if (/win/i.test(said)) return "windows";
  if (/linux|x11/i.test(said)) return "linux";
  return "other";
}

defineUiPlugin({
  async mount(ctx) {
    const t = (/** @type {string} */ id, /** @type {Record<string, unknown>} */ params) =>
      ctx.messages.t(id, /** @type {any} */ (params));
    /** @type {import("./app.js").App | null} */
    let app = null;
    const view = createView(document, (action, detail) => void app?.act(action, detail));
    view.words(t);
    const table = await loadOui((url) => fetch(new URL(url, import.meta.url)));
    app = createApp({
      bridge: ctx.bridge,
      runner: createRunner(ctx.bridge, { reason: t("refusal.programsDenied.do") }),
      store: createStore(ctx.bridge),
      oui: () => table,
      t,
      language: () => ctx.messages.language(),
      platform: platformOf(navigator),
      view,
      universal: ctx.universal,
      interval: () => ctx.settings.get(INTERVAL_KEY).then((v) => /** @type {number} */ (v ?? 5)),
    });
    ctx.messages.onChange(() => {
      view.words(t);
      app?.render();
    });
    ctx.settings.onChange((setting) => {
      if (setting.key === INTERVAL_KEY) app?.setInterval(setting.value);
    });
    wireCommands(ctx, app, t, (id, code, message) => new CommandFailed(id, code, message));
    void app.start();
  },
});
