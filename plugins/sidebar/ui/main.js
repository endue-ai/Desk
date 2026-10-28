// The built-in plugin list. It uses only the public bridge API (plugin.list, plugin.setEnabled,
// plugin.changed), exactly as a community plugin with plugin:manage would.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";

const scope = { permission: "plugin:manage" };

defineUiPlugin({
  async mount({ pluginId, bridge }) {
    const list = document.querySelector("[data-testid=plugins]");
    const status = document.querySelector("[data-testid=status]");

    const row = (plugin) => {
      const item = document.createElement("li");
      const label = document.createElement("label");
      const toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.checked = plugin.enabled;
      // The list cannot turn itself off; there would be no way back.
      toggle.disabled = plugin.status !== "ready" || plugin.id === pluginId;
      toggle.addEventListener("change", async () => {
        try {
          await bridge.call("plugin.setEnabled", {
            plugin: plugin.id,
            enabled: toggle.checked,
            scope,
          });
        } catch (error) {
          toggle.checked = !toggle.checked;
          status.textContent = `${plugin.id}: ${error.code ?? "error"}`;
        }
      });
      const name = plugin.manifest?.name ?? plugin.id;
      label.append(toggle, ` ${name}`);
      item.append(label);
      if (plugin.status === "failed") {
        const reason = document.createElement("small");
        reason.textContent = plugin.error ?? "failed";
        item.append(reason);
      }
      return item;
    };

    const refresh = async () => {
      const { plugins } = await bridge.call("plugin.list", { scope });
      list.replaceChildren(...plugins.map(row));
      status.textContent = `${plugins.length} installed`;
    };

    bridge.onEvent((event) => {
      if (event.event === "plugin.changed") void refresh();
    });
    await refresh();
  },
});
