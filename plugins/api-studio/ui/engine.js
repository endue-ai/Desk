// curl over the bridge: one `proc.spawn` per request without a shell, the config written to stdin
// (which then closes), stdout gathered as bytes and stderr as text from `proc.output` events until
// `proc.exit`. A send can be cancelled (curl is killed); a missing grant is asked for once.

import { ARGS, curlConfig } from "./curl-config.js";

/**
 * @typedef {{ call(method: string, params: any): Promise<any>, onEvent(listener: (event: any) => void): unknown }} Bridge
 * @typedef {{ code: number | null, signal: string | null, stdout: Uint8Array, stderr: string,
 *   cancelled: boolean }} RunResult
 * @typedef {{ promise: Promise<RunResult>, cancel(): void }} Running
 */

export const SCOPE = Object.freeze({ permission: "proc:spawn", commands: ["curl"] });
const scope = () => ({ ...SCOPE, commands: [...SCOPE.commands] });

/** Where curl usually is when the desk's own PATH misses it. */
export const FALLBACK_PATH = ["/usr/bin", "/bin", "/usr/local/bin", "/opt/homebrew/bin"].join(":");

/** The most a response may hold before curl is stopped: bodies past this are not kept. */
export const OUTPUT_LIMIT = 64 * 1024 * 1024;

export class EngineError extends Error {
  /** @param {string} message @param {string} [kind] missing, denied, unsupported or failed */
  constructor(message, kind = "failed") {
    super(message);
    this.name = "EngineError";
    this.kind = kind;
  }
}

const codeOf = (/** @type {any} */ error) => error?.code ?? "error";

/** Bytes from a proc.output chunk in either encoding. @param {string} data @param {string} [encoding] */
export function chunkBytes(data, encoding) {
  if (encoding === "base64") {
    const bin = atob(data);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(data);
}

/** @param {Uint8Array[]} parts @param {number} size */
function joinBytes(parts, size) {
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * @param {Bridge} bridge
 * @param {{ program?(): string, onBusy?(running: number): void }} [options] `program`: curl's
 *   path from Settings, empty for `curl` on PATH.
 */
export function createEngine(bridge, options = {}) {
  /** @type {Map<string, (event: any) => void>} */
  const jobs = new Map();
  /** @type {Map<string, any[]>} */
  const early = new Map();
  let running = 0;
  let fallback = false;
  const busy = (/** @type {number} */ delta) => {
    running += delta;
    options.onBusy?.(running);
  };

  bridge.onEvent((event) => {
    if (event.event !== "proc.output" && event.event !== "proc.exit") return;
    const job = jobs.get(event.data.procId);
    if (job) return job(event);
    const kept = early.get(event.data.procId) ?? [];
    kept.push(event);
    early.set(event.data.procId, kept);
    if (early.size > 32) early.delete(/** @type {string} */ (early.keys().next().value));
  });

  /** @param {any} params */
  const spawnOnce = (params) => bridge.call("proc.spawn", params);

  /** Start curl, falling back to the usual folders, then asking for the grant once. */
  const spawn = async () => {
    const program = options.program?.() || "curl";
    const params = {
      command: program,
      args: [...ARGS],
      env: fallback ? { PATH: FALLBACK_PATH } : {},
      scope: program === "curl" ? scope() : { permission: "proc:spawn", commands: [program] },
    };
    const refused = (/** @type {unknown} */ error) => {
      const code = codeOf(error);
      if (code === "unsupported")
        return new EngineError(
          "This desk cannot run programs, so requests cannot go out.",
          "unsupported",
        );
      if (code === "not_found")
        return new EngineError(
          "curl is not installed or not on PATH: install curl, or name its path under Settings.",
          "missing",
        );
      return new EngineError(`Could not start curl: ${code}.`);
    };
    try {
      return await spawnOnce(params);
    } catch (error) {
      if (codeOf(error) === "not_found" && !fallback && program === "curl") {
        const found = await spawnOnce({ ...params, env: { PATH: FALLBACK_PATH } }).catch(
          () => undefined,
        );
        if (found) {
          fallback = true;
          return found;
        }
      }
      if (codeOf(error) !== "permission_denied") throw refused(error);
    }
    const decision = await bridge
      .call("perm.request", { permission: params.scope, reason: "To send HTTP requests with curl" })
      .catch(() => ({ granted: false }));
    if (!decision?.granted) throw new EngineError("Not allowed to run curl.", "denied");
    try {
      return await spawnOnce(params);
    } catch (error) {
      throw refused(error);
    }
  };

  /**
   * Send one prepared request. `onProgress` hears the bytes received so far.
   * @param {import("./curl-config.js").Prepared} prep
   * @param {{ onProgress?(bytes: number): void, verbose?: boolean }} [hooks]
   * @returns {Running}
   */
  const send = (prep, hooks = {}) => {
    let cancelled = false;
    /** @type {string | undefined} */
    let procId;
    /** @type {(() => void) | undefined} */
    let stop;
    const promise = (async () => {
      const started = await spawn();
      procId = String(started.procId);
      const id = procId;
      busy(1);
      try {
        return await new Promise((resolve, reject) => {
          /** @type {Uint8Array[]} */
          const out = [];
          let outSize = 0;
          let err = "";
          const decoder = new TextDecoder();
          const finish = () => jobs.delete(id);
          stop = () => {
            cancelled = true;
            void bridge
              .call("proc.kill", { procId: id, signal: "kill", scope: scope() })
              .catch(() => {});
          };
          const feed = (/** @type {any} */ event) => {
            if (event.event === "proc.output") {
              const bytes = chunkBytes(event.data.data, event.data.encoding);
              if (event.data.stream === "stderr") err += decoder.decode(bytes, { stream: true });
              else if (outSize + bytes.length <= OUTPUT_LIMIT) {
                out.push(bytes);
                outSize += bytes.length;
                hooks.onProgress?.(outSize);
              } else stop?.();
            } else if (event.event === "proc.exit") {
              finish();
              resolve({
                code: event.data.code ?? null,
                signal: event.data.signal ?? null,
                stdout: joinBytes(out, outSize),
                stderr: err + decoder.decode(),
                cancelled,
              });
            }
          };
          jobs.set(id, feed);
          for (const event of early.get(id) ?? []) feed(event);
          early.delete(id);
          const config = curlConfig(prep, { verbose: hooks.verbose });
          bridge
            .call("proc.write", {
              procId: id,
              data: config,
              encoding: "utf8",
              close: true,
              scope: scope(),
            })
            .catch((/** @type {unknown} */ error) => {
              finish();
              stop?.();
              reject(new EngineError(`Could not hand the request to curl: ${codeOf(error)}.`));
            });
        });
      } finally {
        busy(-1);
      }
    })();
    return {
      promise,
      cancel: () => {
        cancelled = true;
        if (stop) stop();
        else if (procId)
          void bridge.call("proc.kill", { procId, signal: "kill", scope: scope() }).catch(() => {});
      },
    };
  };

  /** curl's version line, or undefined when it cannot run. */
  const version = async () => {
    try {
      const program = options.program?.() || "curl";
      const { procId } = await bridge.call("proc.spawn", {
        command: program,
        args: ["--version"],
        env: fallback ? { PATH: FALLBACK_PATH } : {},
        scope: program === "curl" ? scope() : { permission: "proc:spawn", commands: [program] },
      });
      return await new Promise((resolve) => {
        let text = "";
        const timer = setTimeout(() => {
          jobs.delete(procId);
          resolve(undefined);
        }, 5000);
        const feed = (/** @type {any} */ event) => {
          if (event.event === "proc.output" && event.data.stream === "stdout")
            text += new TextDecoder().decode(chunkBytes(event.data.data, event.data.encoding));
          else if (event.event === "proc.exit") {
            clearTimeout(timer);
            jobs.delete(procId);
            resolve(text.split("\n")[0]?.trim() || undefined);
          }
        };
        jobs.set(procId, feed);
        for (const event of early.get(procId) ?? []) feed(event);
        early.delete(procId);
      });
    } catch {
      return undefined;
    }
  };

  return { send, version, running: () => running };
}
