// What a terminal sends its process, one call at a time and in the order it was made (#160): keys
// typed in one burst reach the program as they were typed, however the bridge carries calls that
// overlap. Text typed while a write is on its way waits and goes out as one write after it; a
// resize keeps its place between the writes, and of several waiting in a row only the last goes.
// Bytes that are not text (xterm.js's binary mouse reports, issue 319) go as base64, in their
// place, and join only other bytes. No DOM.
import { codeOf } from "./spawn.js";

/**
 * @typedef {{ cols: number, rows: number }} Size
 * @typedef {ReturnType<typeof import("./spawn.js").scopeOf>} Scope
 * @typedef {string | { binary: string }} Input text, or bytes as a string of char codes 0 to 255
 * @typedef {"utf8" | "base64"} Encoding
 * @typedef {{ method: "proc.write", params: { procId: string, data: string, encoding: Encoding, scope: Scope } }
 *   | { method: "proc.resize", params: { procId: string, size: Size, scope: Scope } }} Call
 */

/** Bytes held in a string's char codes, as base64. */
const base64Of = (/** @type {string} */ binary) =>
  btoa(Array.from(binary, (c) => String.fromCharCode(c.charCodeAt(0) & 0xff)).join(""));

/** Two writes of one encoding as one. */
const join = (
  /** @type {Encoding} */ encoding,
  /** @type {string} */ a,
  /** @type {string} */ b,
) => (encoding === "utf8" ? a + b : btoa(atob(a) + atob(b)));

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
    if (
      call.method === "proc.write" &&
      last?.method === "proc.write" &&
      last.params.encoding === call.params.encoding
    ) {
      const data = join(call.params.encoding, last.params.data, call.params.data);
      last.params = { ...last.params, data };
    } else if (call.method === "proc.resize" && last?.method === "proc.resize") {
      queue[queue.length - 1] = call;
    } else {
      queue.push(call);
    }
  };

  return {
    /** Type `data` into the process: text as UTF-8, bytes as base64. */
    write(/** @type {string} */ procId, /** @type {Scope} */ scope, /** @type {Input} */ data) {
      const text = typeof data === "string";
      const encoding = /** @type {Encoding} */ (text ? "utf8" : "base64");
      const params = { procId, data: text ? data : base64Of(data.binary), encoding, scope };
      enqueue(procId, { method: "proc.write", params });
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
