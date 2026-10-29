// The app e2e's test plugin (a copy of examples/plugin-hello-ui). `bridge: ok` tells a spec that the
// surface mounted and its bridge answered.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";

defineUiPlugin({
  async mount({ bridge, state }) {
    const revision = new URL(window.location.href).searchParams.get("v") ?? "1";
    document.querySelector("[data-testid=revision]").textContent = `revision ${revision}`;

    const count = document.querySelector("[data-testid=count]");
    let value = state.get()?.count ?? 0;
    count.textContent = String(value);
    document.querySelector("button").addEventListener("click", () => {
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
