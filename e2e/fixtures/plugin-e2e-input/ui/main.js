// The app e2e's input plugin (#56). It records what reaches its text field (keys, compositions, the
// value) and what lands on its drop zone, on `window.e2eInput`, for a spec to read over DevTools in
// the surface's own page. The drop zone takes desk text and paths and copies them.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";

const seen = { events: [], drops: [], value: "" };
window.e2eInput = seen;

defineUiPlugin({
  mount({ dnd }) {
    const field = document.querySelector("[data-testid=field]");
    const kinds = ["keydown", "keyup", "compositionstart", "compositionupdate", "compositionend"];
    for (const kind of [...kinds, "input", "focus", "blur"]) {
      field.addEventListener(kind, (event) => {
        seen.value = field.value;
        seen.events.push({ type: kind, key: event.key, code: event.code, data: event.data });
      });
    }
    const zone = document.querySelector("[data-testid=drop]");
    dnd?.onDrop(
      zone,
      (drop) => {
        seen.drops.push({
          ...(drop.text === undefined ? {} : { text: drop.text }),
          ...(drop.paths === undefined ? {} : { paths: drop.paths }),
          effect: drop.effect,
          from: drop.from,
        });
        zone.textContent = `dropped: ${drop.text ?? drop.paths?.map((p) => p.path).join(", ")}`;
      },
      { accept: ["desk/text", "desk/paths"], effects: ["copy"] },
    );
    document.querySelector("[data-testid=ready]").textContent = "ready";
  },
});
