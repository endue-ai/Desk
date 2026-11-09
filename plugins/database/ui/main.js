// The Database plugin: a client for PostgreSQL, MySQL / MariaDB and SQLite on one surface, through
// their own command-line clients. It uses only the public SDK and bridge API, exactly as a community
// plugin would. What a client printed is read in a worker (output-worker.js, #38).
import { CommandFailed, defineUiPlugin, startWorker } from "@endue-ai/plugin-sdk";
import { defineElements } from "@endue-ai/ui";
import { platformOf } from "./clients.js";
import { createDatabase } from "./database.js";
import { createDatabaseDrops } from "./dnd.js";
import { createOutputReader } from "./output-client.js";
import { createView } from "./view.js";
import { createDropView } from "./view-dnd.js";

defineElements();

defineUiPlugin({
  mount(ctx) {
    /** @type {Record<string, (...args: unknown[]) => unknown> | undefined} */
    let app;
    const view = createView(document, (action, ...args) => app?.[action]?.(...args));
    const database = createDatabase(ctx, view, {
      cancelled: (message) => new CommandFailed("endue.database.run", "cancelled", message),
      platform: platformOf(navigator.platform),
      output: (onBusy) => createOutputReader(startWorker, { onBusy }),
    });
    app = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (
      /** @type {unknown} */ (database)
    );
    createDatabaseDrops(ctx, database, createDropView(document, ctx.dnd, database, view));
  },
});
