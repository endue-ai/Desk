// desk.views: the view engine. It opens view files (view.get) and draws them with the desk's elements
// (@endue-ai/ui), live over the item index, and previews a view Eris proposes (desk.views.preview).
// It uses only the public SDK, as a community plugin would.
import "@endue-ai/ui";
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createEngine } from "./engine.js";
import { createPreview } from "./preview.js";
import { closeOnEscape, createScreen } from "./render.js";

defineUiPlugin({
  mount(ctx) {
    /** @type {import("./engine.js").Engine | undefined} */
    let engine;
    /** @type {import("./preview.js").Preview | undefined} */
    let preview;
    const screen = createScreen(
      document,
      () => engine,
      () => preview,
    );
    engine = createEngine(ctx, screen);
    preview = createPreview(ctx, engine);
    closeOnEscape(document, () => engine);
  },
});
