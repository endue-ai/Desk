// The SQL parse worker, started with the SDK's startWorker (client.js): scripts in, statements with
// their trees, or their names bound against a schema model, out. PostgreSQL's grammar in WebAssembly
// (wasm.js, ADR 0283) runs here, never on the frame's thread. It fetches its wasm from the plugin's
// folder once and compiles it once; a parser that stopped (a trap) is started again for the next
// request. Models come once each, by key, and are kept until the page says to forget them. It
// imports only relative files: import maps do not reach a module worker.
import { indexModel } from "./model.js";
import { createParse } from "./parse.js";
import { createPositions } from "./positions.js";
import { resolve } from "./resolve.js";
import { loadLibpgQuery } from "./wasm.js";

/**
 * @typedef {import("./model.js").SchemaModel} SchemaModel
 * @typedef {import("./parse.js").Parsed} Parsed
 * @typedef {{ id: number, type: "parse", sql: string, trees: boolean }
 *   | { id: number, type: "resolve", sql: string, model: number, searchPath?: string[], user?: string }
 *   | { type: "model", key: number, model: SchemaModel }
 *   | { type: "forget", key: number }} Request
 * @typedef {{ id: number, result: unknown } | { id: number, error: string }} Reply
 */

const WASM = new URL("../../vendor/libpg-query.wasm", import.meta.url);

const messageOf = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);

/** The statements without their trees. @param {Parsed} parsed @returns {Parsed} */
export const outline = (parsed) => ({
  ...parsed,
  statements: parsed.statements.map((s) => ({ ...s, tree: null })),
});

/**
 * Answers requests with a started parser. `models` outlives a parser that is started again.
 * @param {import("./wasm.js").RawParser} raw
 * @param {Map<number, import("./model.js").ModelIndex>} [models]
 */
export function createService(raw, models = new Map()) {
  const parse = createParse(raw);
  return {
    raw,
    /** @param {Request} request @returns {Reply | undefined} */
    answer(request) {
      if (request.type === "model") {
        models.set(request.key, indexModel(request.model));
        return undefined;
      }
      if (request.type === "forget") {
        models.delete(request.key);
        return undefined;
      }
      const { id, sql } = request;
      try {
        const positions = createPositions(sql);
        const parsed = parse(sql, positions);
        if (request.type === "parse")
          return { id, result: request.trees ? parsed : outline(parsed) };
        const index = models.get(request.model);
        if (!index) throw new Error("The schema model was not sent to the parser.");
        const { searchPath, user } = request;
        const bound = resolve(sql, parsed, index, { searchPath, user, positions });
        return { id, result: { ...outline(parsed), ...bound } };
      } catch (error) {
        return { id, error: messageOf(error) };
      }
    },
  };
}

/** @type {Map<number, import("./model.js").ModelIndex>} */
const models = new Map();
/** @type {Promise<WebAssembly.Module> | undefined} */
let compiled;
/** @type {Promise<ReturnType<typeof createService>> | undefined} */
let running;

/** The service, loading the parser first, or again after it stopped. */
async function service() {
  compiled ??= fetch(WASM)
    .then((answer) => {
      if (!answer.ok) throw new Error(`The SQL parser could not be read (${answer.status}).`);
      return answer.arrayBuffer();
    })
    .then((bytes) => WebAssembly.compile(bytes));
  compiled.catch(() => {
    compiled = undefined;
  });
  running ??= compiled.then(loadLibpgQuery).then((raw) => createService(raw, models));
  const current = await running.catch((error) => {
    running = undefined;
    throw error;
  });
  if (!current.raw.broken()) return current;
  running = undefined;
  return service();
}

const scope = /** @type {{ postMessage?(message: Reply): void, onmessage: unknown }} */ (
  /** @type {unknown} */ (globalThis)
);
if (typeof scope.postMessage === "function" && typeof document === "undefined") {
  const post = scope.postMessage.bind(scope);
  scope.onmessage = async (/** @type {MessageEvent<Request>} */ event) => {
    const request = event.data;
    try {
      const reply = (await service()).answer(request);
      if (reply) post(reply);
    } catch (error) {
      if ("id" in request) post({ id: request.id, error: messageOf(error) });
    }
  };
}
