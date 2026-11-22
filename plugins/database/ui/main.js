// The Database plugin: a client for PostgreSQL, MySQL / MariaDB and SQLite on one surface, through
// their own command-line clients. It uses only the public SDK and bridge API, exactly as a community
// plugin would. What a client printed is read in a worker (output-worker.js, #38), and SQL is parsed
// by PostgreSQL's grammar in a worker of its own (sql/parse/worker.js, ADR 0283). A large ER diagram is
// laid out in a worker too, and drawn as an image by the page (features/diagram/, PG-55).
import { CommandFailed, defineUiPlugin, startWorker } from "@endue-ai/plugin-sdk";
import { defineElements } from "@endue-ai/ui";
import { createChartPage, provideChartPage } from "./chart/page.js";
import { platformOf } from "./clients.js";
import { createDatabase } from "./database.js";
import { createDatabaseDrops } from "./dnd.js";
import { createPlanReader } from "./explain/reader.js";
import { createImager } from "./features/diagram/image.js";
import { provideImager } from "./features/diagram/imager.js";
import { provideLayoutWorker } from "./features/diagram/layout-client.js";
import { createOutputReader } from "./output-client.js";
import { provideSqlParser } from "./sql/parse/client.js";
import { loadLanguage } from "./strings/index.js";
import { createView } from "./view.js";
import { createDropView } from "./view-dnd.js";

defineElements();
// Its worker starts on the first parse.
provideSqlParser(startWorker);
provideLayoutWorker(startWorker);
provideImager(createImager(document));
provideChartPage(createChartPage(document));

defineUiPlugin({
  async mount(ctx) {
    // The words in the desk's language (ui/strings/, PG-108): what is drawn after a change follows it.
    await loadLanguage(ctx.messages.language());
    ctx.messages.onChange((language) => void loadLanguage(language));
    /** @type {Record<string, (...args: unknown[]) => unknown> | undefined} */
    let app;
    const view = createView(document, (action, ...args) => app?.[action]?.(...args), undefined, {
      startWorker,
    });
    const database = createDatabase(ctx, view, {
      cancelled: (message) => new CommandFailed("endue.database.run", "cancelled", message),
      platform: platformOf(navigator.platform),
      output: (onBusy) => createOutputReader(startWorker, { onBusy }),
      plans: createPlanReader(startWorker),
      startWorker,
    });
    app = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (
      /** @type {unknown} */ (database)
    );
    createDatabaseDrops(ctx, database, createDropView(document, ctx.dnd, database, view));
  },
});
