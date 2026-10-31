// The sheets plugin: every spreadsheet in one grid, read-only. It uses only the public SDK and
// bridge API, exactly as a community plugin would; SheetJS is vendored in ./vendor (ADR 0043).
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createSheets } from "./sheets.js";
import { createView } from "./view.js";

defineUiPlugin({
  mount(ctx) {
    createSheets(ctx, createView(document));
  },
});
