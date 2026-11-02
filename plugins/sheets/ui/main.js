// The sheets plugin: every spreadsheet in one grid, CSV and TSV editable. It uses only the public
// SDK and bridge API, exactly as a community plugin would; SheetJS is vendored in ./vendor (ADR 0043).
import { defineUiPlugin, readBytes, startWorker } from "@endue-ai/plugin-sdk";
import { defineElements } from "@endue-ai/ui";
import { parseInWorker } from "./parse.js";
import { createSheets } from "./sheets.js";
import { createView } from "./view.js";

defineElements();

defineUiPlugin({
  mount(ctx) {
    /** @type {import("./sheets.js").Sheets | undefined} */
    let app;
    const view = createView(document, { edit: (r, c, text) => app?.edit(r, c, text) ?? false });
    app = createSheets(ctx, view, {
      read: readBytes,
      open: (bytes, file, options) => parseInWorker(bytes, file, options, startWorker),
    });
  },
});
