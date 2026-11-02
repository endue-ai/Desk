// The inspector: what the desk holds now, read-only, section by section. It uses only the public
// bridge API (and the runtime's desk.inspect.open), exactly as a community plugin with these grants
// would.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createInspector } from "./controller.js";
import { createView } from "./view.js";

defineUiPlugin({
  async mount(ctx) {
    /** @type {ReturnType<typeof createInspector> | undefined} */
    let app;
    const view = createView(document, {
      show: (section) => void app?.show(section),
      filter: (query) => app?.filter(query),
      exportJson: () => void app?.exportJson(),
    });
    app = createInspector(ctx, view, {
      every: (ms, tick) => {
        const timer = setInterval(tick, ms);
        return () => clearInterval(timer);
      },
    });
    await app.ready;
  },
});
