// Docker Studio: a graphical client for the Docker engine on one surface, on the public SDK and
// bridge only, exactly as a community plugin would be.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { wireCommands } from "./commands.js";
import { PAGES } from "./pages.js";
import { createStudio } from "./studio.js";

defineUiPlugin({
  mount(ctx) {
    const app = createStudio(ctx, document, PAGES);
    wireCommands(ctx, app);
    app.start();
    document.body.dataset.ready = "1";
  },
});
