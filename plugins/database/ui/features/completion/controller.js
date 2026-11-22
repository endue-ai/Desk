// What completion offers at the editor's caret for the console on screen (ADR 0327). A PostgreSQL
// console with a schema cache asks the parse worker, which completes over the problems check's
// model and state and the resolver's scope (editor/statement.js): nothing is asked of the server.
// Other consoles, or one whose cache lists nothing yet, complete on the page from the catalog
// (quietly from its cache when it can): the schemas, the default schema's objects and the columns
// of the tables the statement names, at most four of them. Either way the person's picks rank
// candidates (picks.js) and the snippets the settings add are offered where they fit. Inside a
// PL/pgSQL body (ADR 0343) the worker completes even without a cache, for the body's variables. No
// DOM.

import { problemModel } from "../../diagnose/model.js";
import { complete } from "../../editor/complete.js";
import { snippetsOf } from "../../editor/snippets.js";
import { engineOf } from "../../engines/index.js";
import { sqlParser } from "../../sql/parse/client.js";
import { bodyAt } from "../../sql/plpgsql/bodies.js";
import { picksFor } from "./picks.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../editor/complete.js").Completion} Completion
 * @typedef {"items" | "signature" | "star"} Want
 */

const COMPLETE_READS = 4;
/** The server's default search path; a role's or a database's own is not known until a session says. */
const SEARCH_PATH = ["$user", "public"];

/**
 * @param {Pick<Deps, "consoles" | "manager" | "catalog" | "settings" | "bridge">} deps
 * @param {() => ReturnType<typeof sqlParser>} [parser]
 */
export function createCompletion(deps, parser = sqlParser) {
  const picks = picksFor(deps.bridge);
  const quiet = (/** @type {Promise<unknown>} */ p) => p.catch(() => undefined);

  /** On the page, from the catalog. */
  const onPage = async (
    /** @type {import("../../engines/common.js").Connection} */ conn,
    /** @type {string} */ text,
    /** @type {number} */ caret,
    /** @type {Parameters<typeof complete>[4]} */ options,
  ) => {
    const { dialect } = engineOf(conn.engine);
    const first = deps.catalog.snapshot(conn);
    await Promise.all([
      quiet(deps.catalog.schemas(conn, true)),
      ...(first.defaultSchema
        ? [quiet(deps.catalog.objects(conn, first.defaultSchema, true))]
        : []),
    ]);
    let found = complete(text, caret, dialect, deps.catalog.snapshot(conn), options);
    if (found.wants.length) {
      const reads = found.wants
        .slice(0, COMPLETE_READS)
        .map((w) => quiet(deps.catalog.columns(conn, w.schema, w.table, true)));
      await Promise.all(reads);
      found = complete(text, caret, dialect, deps.catalog.snapshot(conn), options);
    }
    return found;
  };

  return {
    /**
     * @param {string} text the statement around the caret
     * @param {number} caret in it
     * @param {number} [offset] where the statement starts in the console
     * @param {Want} [want] items (the default), the call's signature, or `*` written out
     * @returns {Promise<Completion | undefined>}
     */
    async complete(text, caret, offset = 0, want = /** @type {Want} */ ("items")) {
      const shown = deps.consoles.current();
      const conn = shown ? deps.manager.get(shown.connection) : undefined;
      if (!shown || !conn) return undefined;
      const { dialect } = engineOf(conn.engine);
      const options = {
        picks: await picks.get(),
        want,
        snippets: snippetsOf(dialect, deps.settings().snippets),
      };
      const sql = parser();
      const model =
        conn.engine === "postgresql" && sql
          ? problemModel(conn.id, deps.catalog.cache.view(conn))
          : null;
      // A PL/pgSQL body's variables need no cache: the worker completes there without one.
      const body =
        conn.engine === "postgresql" && !model && text.includes("$") && bodyAt(text, caret);
      if (sql && (model || body))
        return sql.complete(text, model, {
          doc: shown.id,
          caret,
          offset,
          searchPath: [...SEARCH_PATH],
          user: conn.user,
          ...options,
        });
      return onPage(conn, text, caret, options);
    },
  };
}
