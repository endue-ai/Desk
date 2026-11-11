// The app e2e's popup plugin (#156). It records each field's value and the keys and changes that
// reach it on `window.e2ePopup`, for a spec to read over DevTools in the surface's own page: a key
// the page itself hears while a field's popup is open shows there too.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";

const seen = { values: {}, events: [] };
window.e2ePopup = seen;

defineUiPlugin({
  mount() {
    for (const field of document.querySelectorAll("select, input")) {
      const name = field.dataset.testid;
      seen.values[name] = field.value;
      for (const kind of ["input", "change", "keydown"]) {
        field.addEventListener(kind, (event) => {
          seen.values[name] = field.value;
          seen.events.push({ type: kind, field: name, key: event.key, value: field.value });
        });
      }
    }
    document.querySelector("[data-testid=ready]").textContent = "ready";
  },
});
