// The sheets plugin: every spreadsheet in one grid, read-only. It uses only the public SDK and
// bridge API, exactly as a community plugin would; SheetJS is vendored in ./vendor (ADR 0043).
import { defineUiPlugin, readBytes, startWorker } from "@endue-ai/plugin-sdk";
import { defineElements } from "@endue-ai/ui";
import { parseInWorker } from "./parse.js";
import { createSheets } from "./sheets.js";
import { createView } from "./view.js";

defineElements();

defineUiPlugin({
  mount(ctx) {
    createSheets(ctx, createView(document), {
      read: readBytes,
      open: (bytes, file, options) => parseInWorker(bytes, file, options, startWorker),
    });
  },
});
