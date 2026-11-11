// What a terminal sends its process, one call at a time and in the order it was made (#160): keys
// typed in one burst reach the program as they were typed, however the bridge carries calls that
// overlap. Text typed while a write is on its way waits and goes out as one write after it; a
// resize keeps its place between the writes, and of several waiting in a row only the last goes.
// No DOM.
import { codeOf } from "./spawn.js";

/**
 * @typedef {{ cols: number, rows: number }} Size
 * @typedef {ReturnType<typeof import("./spawn.js").scopeOf>} Scope
 * @typedef {{ method: "proc.write", params: { procId: string, data: string, encoding: "utf8", scope: Scope } }
 *   | { method: "proc.resize", params: { procId: string, size: Size, scope: Scope } }} Call
 */

/**
 * @param {{ call(method: string, params: unknown): Promise<unknown> }} bridge
 * @param {(procId: string, method: Call["method"], code: string) => void} failed A call failed
 *   with `code`; `not_found` says the core no longer has the process.
 */
export function createPipes(bridge, failed) {
  /** Process id -> the calls waiting behind the one on its way. @type {Map<string, Call[]>} */
  const waiting = new Map();

  const send = (/** @type {string} */ procId, /** @type {Call} */ call) => {
    bridge
      .call(call.method, call.params)
      .catch((error) => failed(procId, call.method, codeOf(error)))
      .finally(() => {
        const next = waiting.get(procId)?.shift();
        if (next) send(procId, next);
        else waiting.delete(procId);
      });
  };

  const enqueue = (/** @type {string} */ procId, /** @type {Call} */ call) => {
    const queue = waiting.get(procId);
    if (!queue) {
      waiting.set(procId, []);
      send(procId, call);
      return;
    }
    const last = queue.at(-1);
    if (call.method === "proc.write" && last?.method === "proc.write") {
      last.params = { ...last.params, data: last.params.data + call.params.data };
    } else if (call.method === "proc.resize" && last?.method === "proc.resize") {
      queue[queue.length - 1] = call;
    } else {
      queue.push(call);
    }
  };

  return {
    /** Type `data` into the process. */
    write(/** @type {string} */ procId, /** @type {Scope} */ scope, /** @type {string} */ data) {
      enqueue(procId, {
        method: "proc.write",
        params: { procId, data, encoding: "utf8", scope },
      });
    },
    /** Give the process's PTY a new size. */
    resize(/** @type {string} */ procId, /** @type {Scope} */ scope, /** @type {Size} */ size) {
      enqueue(procId, { method: "proc.resize", params: { procId, size, scope } });
    },
    /** The process is gone: what waits for it is dropped. */
    drop(/** @type {string} */ procId) {
      waiting.get(procId)?.splice(0);
    },
  };
}
