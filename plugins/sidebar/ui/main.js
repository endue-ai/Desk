// The built-in plugin list. It uses only the public bridge API (plugin.list, plugin.setEnabled,
// plugin.changed), exactly as a community plugin with plugin:manage would. The rows are rows.js's.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { row, status as statusText } from "./rows.js";

const scope = { permission: "plugin:manage" };
const platform = (navigator.platform ?? "").toLowerCase().startsWith("mac") ? "mac" : "other";

defineUiPlugin({
  async mount({ pluginId, bridge }) {
    const list = document.querySelector("[data-testid=plugins]");
    const status = document.querySelector("[data-testid=status]");

    const toggle = async (plugin, enabled) => {
      try {
        await bridge.call("plugin.setEnabled", { plugin, enabled, scope });
      } catch (error) {
        status.textContent = `${plugin}: ${error.code ?? "error"}`;
        throw error;
      }
    };

    const refresh = async () => {
      const { plugins } = await bridge.call("plugin.list", { scope });
      list.replaceChildren(...plugins.map((p) => row(document, p, { self: pluginId, toggle })));
      status.textContent = statusText(plugins.length, platform);
    };

    bridge.onEvent((event) => {
      if (event.event === "plugin.changed") void refresh();
    });
    await refresh();
  },
});
