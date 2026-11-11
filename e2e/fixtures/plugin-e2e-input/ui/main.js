// The app e2e's input plugin (#56). It records what reaches its text field (keys, compositions, the
// value) and what lands on its drop zone, on `window.e2eInput`, for a spec to read over DevTools in
// the surface's own page. The drop zone takes desk text and paths and copies them. The text area
// under the rest has lines, for the keys that go to a document's ends (#156); a spec lists in
// `cancel` the codes of the chords this page cancels, as a page that binds them itself does, and
// the clipboard's events on either control are recorded too. The custom-cursor box draws its own
// menu, as a page that has one does: it cancels the right click, which it records.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";

const seen = { events: [], drops: [], value: "", cancel: [] };
window.e2eInput = seen;

defineUiPlugin({
  mount({ dnd }) {
    const field = document.querySelector("[data-testid=field]");
    const area = document.querySelector("[data-testid=area]");
    const kinds = ["keydown", "keyup", "compositionstart", "compositionupdate", "compositionend"];
    for (const kind of [...kinds, "input", "focus", "blur"]) {
      field.addEventListener(kind, (event) => {
        seen.value = field.value;
        seen.events.push({ type: kind, key: event.key, code: event.code, data: event.data });
      });
    }
    for (const control of [field, area]) {
      control.addEventListener("keydown", (event) => {
        const chord = event.metaKey || event.ctrlKey;
        if (chord && seen.cancel.includes(event.code)) event.preventDefault();
      });
      for (const kind of ["copy", "cut", "paste"]) {
        control.addEventListener(kind, () => {
          seen.events.push({ type: kind, target: control.dataset.testid });
        });
      }
    }
    document.querySelector("[data-testid=custom]").addEventListener("contextmenu", (event) => {
      event.preventDefault();
      seen.events.push({ type: "contextmenu", target: "custom" });
    });
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
