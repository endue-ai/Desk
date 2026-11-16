// Running a script: the prelude and the script's own text become one worker's source (the desk
// runs no eval, but a worker from a blob is allowed), the worker gets ten seconds, and what it
// posts back (logs, tests, variables, a changed request) is the result. A syntax error or a throw
// comes back as words with the script's own line number.

import { prelude } from "./script-prelude.js";

/**
 * @typedef {{ phase: "pre" | "post" | "tests", name: string, vars: Record<string, string>,
 *   request?: { method: string, url: string, headers: [string, string][], body: string, bodyChanged?: boolean },
 *   response?: { status: number, reason: string, headers: [string, string][], text: string, time: number, size: number, url: string } }} ScriptContext
 * @typedef {{ logs: { level: string, text: string }[], tests: { name: string, ok: boolean, error?: string }[],
 *   vars: Record<string, string>, env: Record<string, string>, skip: boolean,
 *   request?: ScriptContext["request"], error?: string }} ScriptResult
 * @typedef {(source: string, timeoutMs: number) => Promise<any>} Spawn
 */

export const TIMEOUT_MS = 10_000;

/** The worker's whole source for a script, and the line the script starts on. @param {string} code @param {ScriptContext} ctx */
export function workerSource(code, ctx) {
  const head = `(${prelude.toString()})(${JSON.stringify(ctx)});\n(async () => {\ntry {\n`;
  const offset = head.split("\n").length - 1;
  return {
    source: `${head}${code}\n} catch (error) {\nawait __finish(error);\nreturn;\n}\nawait __finish(undefined);\n})();\n`,
    offset,
  };
}

/** Run a source in a browser worker made from a blob. @type {Spawn} */
export const browserSpawn = (source, timeoutMs) =>
  new Promise((resolve) => {
    /** @type {Worker} */
    let worker;
    let url = "";
    try {
      url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
      worker = new Worker(url);
    } catch (error) {
      resolve({
        fatal: `Scripts cannot run on this desk: ${String(/** @type {Error} */ (error)?.message ?? error)}`,
      });
      return;
    }
    const done = (/** @type {unknown} */ value) => {
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(
      () => done({ fatal: `The script ran longer than ${timeoutMs / 1000} s and was stopped.` }),
      timeoutMs,
    );
    worker.onmessage = (event) => done(event.data);
    worker.onerror = (event) => {
      event.preventDefault();
      done({ fatal: event.message || "The script could not run.", line: event.lineno });
    };
  });

/** An empty result. @returns {ScriptResult} */
export const nothing = () => ({ logs: [], tests: [], vars: {}, env: {}, skip: false });

/**
 * Run one script and give back what it did.
 * @param {string} code @param {ScriptContext} ctx @param {{ spawn?: Spawn, timeoutMs?: number }} [options]
 * @returns {Promise<ScriptResult>}
 */
export async function runScript(code, ctx, options = {}) {
  if (!code.trim()) return nothing();
  const { source, offset } = workerSource(code, ctx);
  const answer = await (options.spawn ?? browserSpawn)(source, options.timeoutMs ?? TIMEOUT_MS);
  if (answer?.fatal) {
    const line =
      typeof answer.line === "number" && answer.line > offset
        ? ` (line ${answer.line - offset})`
        : "";
    return { ...nothing(), error: `${answer.fatal}${line}` };
  }
  return { ...nothing(), ...answer };
}
