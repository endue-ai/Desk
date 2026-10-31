// The Database plugin: a client for PostgreSQL, MySQL / MariaDB and SQLite on one surface, through
// their own command-line clients. It uses only the public SDK and bridge API, exactly as a community
// plugin would.
import { CommandFailed, defineUiPlugin } from "@endue-ai/plugin-sdk";
import { platformOf } from "./clients.js";
import { createDatabase } from "./database.js";
import { createView } from "./view.js";

defineUiPlugin({
  mount(ctx) {
    /** @type {Record<string, (...args: unknown[]) => unknown> | undefined} */
    let app;
    const view = createView(document, (action, ...args) => app?.[action]?.(...args));
    app = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (
      /** @type {unknown} */ (
        createDatabase(ctx, view, {
          cancelled: (message) => new CommandFailed("endue.database.run", "cancelled", message),
          platform: platformOf(navigator.platform),
        })
      )
    );
  },
});
