// Git Studio: a graphical Git client on one surface, on the public SDK and bridge only, exactly as a
// community plugin would be.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { installFeatures } from "./features.js";
import { createStudio } from "./studio.js";

defineUiPlugin({
  mount(ctx) {
    installFeatures(createStudio(ctx, document), ctx);
    document.body.dataset.ready = "1";
  },
});
