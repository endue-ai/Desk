// The reader plugin: PDFs, e-books and comics in one interface. It uses only the public SDK and
// bridge API, exactly as a community plugin would; pdf.js is vendored in ui/vendor.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { loadPdfjs } from "./pdfjs.js";
import { createReader } from "./reader.js";
import { createView } from "./view.js";

defineUiPlugin({
  mount(ctx) {
    /** @type {ReturnType<typeof createReader> | undefined} */
    let app;
    const view = createView(document, {
      moved: (at) => app?.moved(at),
      zoomed: (zoom) => app?.zoomed(zoom),
      bookmark: (at, label) => app?.bookmark(at, label),
      note: (at, text) => app?.note(at, text),
      forget: (kind, index) => app?.forget(kind, index),
      unlock: (password) => app?.unlock(password),
    });
    app = createReader(ctx, view, { pdfjs: loadPdfjs });
    // A file that breaks a reader halfway through drawing says so; it never ends as an uncaught error.
    window.addEventListener("unhandledrejection", (event) => {
      event.preventDefault();
      const reason =
        /** @type {{ message?: string }} */ (event.reason)?.message ?? String(event.reason);
      view.status(`Part of this file could not be drawn: ${reason}`);
    });
  },
});
