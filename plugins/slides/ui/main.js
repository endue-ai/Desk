// The slides plugin: every presentation in one viewer with a rail, notes and play mode. It uses only
// the public SDK and bridge API, exactly as a community plugin would.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createSlides } from "./slides.js";
import { createView } from "./view.js";

defineUiPlugin({
  mount(ctx) {
    createSlides(ctx, createView(document));
  },
});
