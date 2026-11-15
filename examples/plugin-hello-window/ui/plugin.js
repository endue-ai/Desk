// The smallest app that says how its window opens (plugin.json's `window`). It shows its page's
// size, which is what the manifest asks for wherever the window opens, a counter kept in plugin
// state, and one bridge call. A move out of the canvas or back loads the page again: the count
// comes back from plugin state, as after a reload. It imports nothing from the SDK, so its test
// runs it on the SDK's test host.
export const plugin = {
  async mount({ bridge, state }) {
    const size = document.querySelector("[data-testid=size]");
    const measure = () => {
      size.textContent = `${window.innerWidth} × ${window.innerHeight}`;
    };
    measure();
    window.addEventListener("resize", measure);

    const count = document.querySelector("[data-testid=count]");
    let value = state.get()?.count ?? 0;
    count.textContent = String(value);
    document.querySelector("desk-button").addEventListener("click", () => {
      value += 1;
      state.set({ count: value });
      count.textContent = String(value);
    });

    // perm.query needs no permission, so this round trip works in both windows.
    const { grants } = await bridge.call("perm.query", {});
    document.querySelector("[data-testid=bridge]").textContent =
      `bridge: ok, ${grants.length} grants`;
  },
};
