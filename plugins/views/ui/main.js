// desk.views: the view engine. It opens view files (view.get) and draws them with the desk's elements
// (@endue-ai/ui), live over the item index. It uses only the public SDK, as a community plugin would.
import "@endue-ai/ui";
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createEngine } from "./engine.js";
import { closeOnEscape, createScreen } from "./render.js";

defineUiPlugin({
  mount(ctx) {
    /** @type {import("./engine.js").Engine | undefined} */
    let engine;
    const screen = createScreen(document, () => engine);
    engine = createEngine(ctx, screen);
    closeOnEscape(document, () => engine);
  },
});
