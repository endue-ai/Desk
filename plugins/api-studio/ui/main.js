// API Studio: an HTTP client for building, sending and testing requests on one surface, on the
// public SDK and bridge only, exactly as a community plugin would be.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createStudio } from "./studio.js";

defineUiPlugin({
  mount(ctx) {
    const studio = createStudio(ctx, document);
    void studio.start().then(() => {
      document.body.dataset.ready = "1";
    });
  },
});
