// The smallest UI plugin: a counter kept in plugin state, so it survives hot reloads, and one
// bridge call. It imports nothing from the SDK, so its test runs it on the SDK's test host.
export const plugin = {
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
};
