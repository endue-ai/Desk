// The calendar plugin: iCalendar files in month, week, day and agenda views, with an event editor.
// It uses only the public SDK and bridge API, exactly as a community plugin would.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createCalendar } from "./calendar.js";
import { createEditor } from "./editor.js";
import { createView } from "./view.js";

defineUiPlugin({
  mount(ctx) {
    /** @type {ReturnType<typeof createCalendar> | undefined} */
    let app;
    const view = createView(document, {
      previous: () => app?.previous(),
      next: () => app?.next(),
      today: () => app?.today(),
      show: (mode) => app?.show(mode),
      goto: (day) => app?.goto(day),
      compose: (at) => app?.compose(at),
      edit: (id) => app?.edit(id),
      ask: () => app?.ask(),
    });
    const editor = createEditor(document, {
      save: (fields, scope) => app?.save(fields, scope),
      remove: (scope) => app?.remove(scope),
      close: () => app?.close(),
    });
    app = createCalendar(ctx, { ...view, editor: editor.open });
    addEventListener("pagehide", () => app?.dispose());
  },
});
