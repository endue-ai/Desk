// The app e2e's accessibility plugin (#57). It counts the clicks its button hears and keeps its
// field's value on `window.e2eA11y`, for a spec to read over DevTools in the surface's own page
// after a screen reader's actions went through the compositor.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";

const seen = { clicks: 0, value: "", focused: false };
window.e2eA11y = seen;

defineUiPlugin({
  mount() {
    const field = document.querySelector("[data-testid=field]");
    field.addEventListener("input", () => {
      seen.value = field.value;
    });
    field.addEventListener("focus", () => {
      seen.focused = true;
    });
    field.addEventListener("blur", () => {
      seen.focused = false;
    });
    document.querySelector("[data-testid=add]").addEventListener("click", () => {
      seen.clicks += 1;
    });
    document.querySelector("[data-testid=ready]").textContent = "ready";
  },
});
