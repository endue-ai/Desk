// The docs plugin: every word-processor document in one page view. It uses only the public SDK and
// bridge API, exactly as a community plugin would.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createDocs } from "./docs.js";
import { createView } from "./view/view.js";

defineUiPlugin({
  mount(ctx) {
    createDocs(ctx, createView(document));
  },
});
