// The page's side of the SQL parser (ADR 0283): every parse and every resolve goes to one worker
// (worker.js), started with the SDK's startWorker on the first request, so PostgreSQL's grammar never
// runs on the frame's thread. `parse` answers the trees; `outline` and `resolve` leave them in the
// worker, since moving a large script's trees to the page costs more than parsing it; `layout`
// answers Format SQL's new text for a script or the statement at a caret (ADR 0291). A schema
// model crosses once per object (pass a new object when the schema changes); the last few are kept.
// Cancel stops the worker while something is in flight, failing it, and the next request starts a
// fresh one; close stops it in any case.
// ui/main.js provides the shared parser; tests make their own with createSqlParser.

/**
 * @typedef {import("./parse.js").Parsed} Parsed
 * @typedef {import("./resolve.js").Resolution} Resolution
 * @typedef {import("./model.js").SchemaModel} SchemaModel
 * @typedef {import("../layout/layout.js").Laid} Laid
 * @typedef {(url: URL, options?: { name?: string }) => Worker} StartWorker
 * @typedef {{
 *   parse(sql: string): Promise<Parsed>,
 *   outline(sql: string): Promise<Parsed>,
 *   resolve(sql: string, model: SchemaModel, options?: { searchPath?: string[], user?: string }): Promise<Parsed & Resolution>,
 *   layout(sql: string, style: import("../layout/style.js").Style, options?: { at?: number }): Promise<Laid>,
 *   cancel(): void,
 *   close(): void,
 *   busy(): number,
 * }} SqlParser
 */

/** Models the worker keeps; an older one is forgotten there and sent again when used. */
const KEPT_MODELS = 4;

export const cancelledParse = () => new DOMException("The parse was cancelled.", "AbortError");

/** @param {StartWorker} startWorker @returns {SqlParser} */
export function createSqlParser(startWorker) {
  /** @type {Worker | undefined} */
  let worker;
  let next = 0;
  /** @type {Map<number, { resolve(value: any): void, reject(error: unknown): void }>} */
  const pending = new Map();
  /** @type {Map<SchemaModel, number>} */
  let models = new Map();

  const stop = (/** @type {unknown} */ error) => {
    worker?.terminate();
    worker = undefined;
    models = new Map();
    const failed = [...pending.values()];
    pending.clear();
    for (const entry of failed) entry.reject(error);
  };
  const started = () => {
    if (worker) return worker;
    const fresh = startWorker(new URL("./worker.js", import.meta.url), {
      name: "Database SQL parser",
    });
    fresh.onmessage = ({ data }) => {
      const entry = pending.get(data.id);
      if (!entry) return;
      pending.delete(data.id);
      if ("error" in data) entry.reject(new Error(data.error));
      else entry.resolve(data.result);
    };
    fresh.onerror = (event) => stop(new Error(event.message || "The SQL parser stopped."));
    worker = fresh;
    return fresh;
  };
  /** @param {Record<string, unknown>} message */
  const ask = (message) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve, reject });
      started().postMessage({ ...message, id });
    });
  const keyOf = (/** @type {SchemaModel} */ model) => {
    const known = models.get(model);
    if (known !== undefined) return known;
    const key = ++next;
    started().postMessage({ type: "model", key, model });
    models.set(model, key);
    if (models.size > KEPT_MODELS) {
      const [oldest, old] = /** @type {[SchemaModel, number]} */ (models.entries().next().value);
      models.delete(oldest);
      started().postMessage({ type: "forget", key: old });
    }
    return key;
  };

  return {
    parse: (sql) => ask({ type: "parse", sql, trees: true }),
    outline: (sql) => ask({ type: "parse", sql, trees: false }),
    resolve: (sql, model, options = {}) =>
      ask({ type: "resolve", sql, model: keyOf(model), ...options }),
    layout: (sql, style, options = {}) => ask({ type: "layout", sql, style, ...options }),
    cancel: () => {
      if (pending.size > 0) stop(cancelledParse());
    },
    close: () => stop(cancelledParse()),
    busy: () => pending.size,
  };
}

/** @type {SqlParser | undefined} */
let shared;

/** The plugin's one parser, made by ui/main.js with the SDK's startWorker. */
export function provideSqlParser(/** @type {StartWorker} */ startWorker) {
  shared = createSqlParser(startWorker);
  return shared;
}

/** The parser ui/main.js provided, for what is built on it; undefined before. */
export const sqlParser = () => shared;
