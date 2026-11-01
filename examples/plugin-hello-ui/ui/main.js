// The smallest UI plugin. Edit this file while `just dev` runs: only this surface reloads,
// and the count comes back because it lives in plugin state, not in the page.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
// The elements define themselves on import; the page uses <desk-button>.
import "@endue-ai/ui";

defineUiPlugin({
  async mount({ bridge, state }) {
    const revision = new URL(window.location.href).searchParams.get("v") ?? "1";
    document.querySelector("[data-testid=revision]").textContent = `revision ${revision}`;

    const count = document.querySelector("[data-testid=count]");
    let value = state.get()?.count ?? 0;
    count.textContent = String(value);
    document.querySelector("desk-button").addEventListener("click", () => {
      value += 1;
      state.set({ count: value });
      count.textContent = String(value);
    });

    // perm.query needs no permission, so this round trip works for every plugin.
    const { grants } = await bridge.call("perm.query", {});
    document.querySelector("[data-testid=bridge]").textContent =
      `bridge: ok, ${grants.length} grants`;
  },
});
