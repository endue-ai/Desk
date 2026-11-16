// The docker program over the bridge: `proc.spawn` without a shell, the context as a global flag,
// output gathered from `proc.output` events by process id until `proc.exit`, timeouts and cancels
// that kill, and one ask with `perm.request` when the grant is missing. Long processes (logs -f,
// events, stats, an exec console) are streams: their lines arrive as they come until they are
// stopped, and a console's stdin takes writes. Every failure is a DockerError in words.

import { explain, kindOf } from "./errors.js";

/**
 * @typedef {{ code: number | null, signal: string | null, stdout: string, stderr: string }} Outcome
 * @typedef {"stdout" | "stderr"} Stream
 * @typedef {{ cwd?: string, timeoutMs?: number, ok?: number[], input?: string,
 *   onLine?(stream: Stream, line: string): void }} RunOptions
 * @typedef {{ cwd?: string, onLine(stream: Stream, line: string): void,
 *   onExit?(outcome: Outcome): void }} StreamOptions
 * @typedef {{ procId: string, stop(): Promise<void>, write(data: string, close?: boolean): Promise<void> }} StreamHandle
 * @typedef {{ feed(event: any): void, cancel?(): void }} Job
 * @typedef {{ call(method: string, params: any): Promise<any>, onEvent(listener: (event: any) => void): unknown }} Bridge
 */

export const SCOPE = Object.freeze({ permission: "proc:spawn", commands: ["docker"] });
const scope = () => ({ ...SCOPE, commands: [...SCOPE.commands] });

/** No "What's next" hints after a command, no colours in what docker writes. */
export const ENV = Object.freeze({ DOCKER_CLI_HINTS: "false", NO_COLOR: "1" });

/** Where docker is usually installed when the desk's own PATH misses it (an app opened from the
 * Finder gets the system's PATH): Homebrew, the engines' app bundles, the system folders. */
export const FALLBACK_PATH = [
  "/usr/local/bin",
  "/opt/homebrew/bin",
  "/Applications/Docker.app/Contents/Resources/bin",
  "/Applications/OrbStack.app/Contents/MacOS/xbin",
  "/usr/bin",
  "/bin",
  "/snap/bin",
].join(":");

export const TIMEOUT_MS = 20_000;
const OUTPUT_LIMIT = 16 * 1024 * 1024;
const LINE_LIMIT = 64 * 1024;
const EARLY = 32;

export class DockerError extends Error {
  /** @param {string} message @param {Partial<Outcome> & { cancelled?: boolean, kind?: string }} [outcome] */
  constructor(message, outcome = {}) {
    super(message);
    this.name = "DockerError";
    this.outcome = outcome;
    this.cancelled = outcome.cancelled === true;
    /** missing, unsupported, denied, daemon, socket, compose, context or undefined. */
    this.kind = outcome.kind ?? kindOf(outcome.stderr ?? "");
  }
}

const codeOf = (/** @type {any} */ error) => error?.code ?? "error";

/**
 * @param {Bridge} bridge
 * @param {{ onBusy?(running: number): void, context?(): string, path?(): string }} [options]
 */
export function createRunner(bridge, options = {}) {
  const onBusy = options.onBusy ?? (() => {});
  const context = options.context ?? (() => "");
  const path = options.path ?? (() => "");
  let fallback = false;
  /** @type {Map<string, Job>} */
  const jobs = new Map();
  /** @type {Map<string, any[]>} */
  const early = new Map();
  let running = 0;

  bridge.onEvent((event) => {
    if (event.event !== "proc.output" && event.event !== "proc.exit") return;
    const job = jobs.get(event.data.procId);
    if (job) return job.feed(event);
    const kept = early.get(event.data.procId) ?? [];
    kept.push(event);
    early.set(event.data.procId, kept);
    const oldest = early.keys().next().value;
    if (early.size > EARLY && oldest !== undefined) early.delete(oldest);
  });

  const adopt = (/** @type {string} */ procId, /** @type {Job} */ job) => {
    jobs.set(procId, job);
    for (const event of early.get(procId) ?? []) job.feed(event);
    early.delete(procId);
  };

  /** @param {string[]} args @param {string | undefined} cwd */
  const spawn = async (args, cwd) => {
    const chosen = path() || (fallback ? FALLBACK_PATH : "");
    const flags = context() ? ["--context", context()] : [];
    const params = {
      command: "docker",
      args: [...flags, ...args],
      ...(cwd ? { cwd } : {}),
      env: { ...ENV, ...(chosen ? { PATH: chosen } : {}) },
      scope: scope(),
    };
    const refused = (/** @type {unknown} */ error) => {
      const code = codeOf(error);
      if (code === "unsupported")
        return new DockerError("This desk cannot run programs: proc.spawn is unsupported.", {
          kind: "unsupported",
        });
      if (code === "not_found")
        return new DockerError(
          "The docker program is not installed or not on PATH: install the Docker engine and its CLI, or set the folder it is in under Settings.",
          { kind: "missing" },
        );
      return new DockerError(`Could not run docker: ${code}.`);
    };
    try {
      return await bridge.call("proc.spawn", params);
    } catch (error) {
      if (codeOf(error) === "not_found" && !chosen) {
        const found = await bridge
          .call("proc.spawn", { ...params, env: { ...params.env, PATH: FALLBACK_PATH } })
          .catch(() => undefined);
        if (found) {
          fallback = true;
          return found;
        }
      }
      if (codeOf(error) !== "permission_denied") throw refused(error);
    }
    const decision = await bridge
      .call("perm.request", { permission: scope(), reason: "To run docker" })
      .catch(() => ({ granted: false }));
    if (!decision?.granted) throw new DockerError("Not allowed to run docker.", { kind: "denied" });
    try {
      return await bridge.call("proc.spawn", params);
    } catch (error) {
      throw refused(error);
    }
  };

  const kill = (/** @type {string} */ procId, /** @type {"term" | "kill"} */ signal) =>
    bridge.call("proc.kill", { procId, signal, scope: scope() }).catch(() => {});
  const write = (/** @type {string} */ procId, /** @type {string} */ data, close = false) =>
    bridge.call("proc.write", { procId, data, encoding: "utf8", close, scope: scope() });

  /**
   * Run docker once and resolve with what it wrote; a non-zero exit (not in `ok`) rejects with a
   * DockerError. `timeoutMs: 0` waits as long as it takes; `input` goes to stdin, which then closes.
   * @param {string[]} args @param {RunOptions} [options] @returns {Promise<Outcome>}
   */
  const run = async (args, options = {}) => {
    const { procId } = await spawn(args, options.cwd);
    const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
    /** @type {Outcome} */
    const outcome = await new Promise((resolve, reject) => {
      const out = sink();
      const err = sink();
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      let timer;
      const finish = () => {
        if (!jobs.delete(procId)) return false;
        if (timer !== undefined) clearTimeout(timer);
        running -= 1;
        onBusy(running);
        return true;
      };
      const fail = (/** @type {DockerError} */ error, /** @type {"term" | "kill"} */ signal) => {
        if (!finish()) return;
        void kill(procId, signal);
        reject(error);
      };
      running += 1;
      onBusy(running);
      if (timeoutMs > 0)
        timer = setTimeout(() => {
          const what = args.find((arg) => !arg.startsWith("-")) ?? "";
          fail(new DockerError(`docker ${what} took longer than ${timeoutMs / 1000} s.`), "term");
        }, timeoutMs);
      const heard = options.onLine;
      const split = heard ? { stdout: lines(), stderr: lines() } : undefined;
      adopt(procId, {
        feed: (event) => {
          if (event.event === "proc.output") {
            const which = event.data.stream === "stderr" ? "stderr" : "stdout";
            const bytes = decode(event.data.data, event.data.encoding);
            if (out.size + err.size + bytes.length <= OUTPUT_LIMIT)
              (which === "stderr" ? err : out).push(bytes);
            else if (!heard)
              fail(
                new DockerError("docker wrote more than 16 MiB; the output was dropped."),
                "kill",
              );
            if (heard && split)
              for (const line of split[which].push(event.data.data, event.data.encoding))
                heard(which, line);
          } else if (event.event === "proc.exit" && finish()) {
            if (heard && split)
              for (const which of /** @type {const} */ (["stdout", "stderr"])) {
                const rest = split[which].end();
                if (rest !== undefined) heard(which, rest);
              }
            resolve({
              code: event.data.code ?? null,
              signal: event.data.signal ?? null,
              stdout: out.text(),
              stderr: err.text(),
            });
          }
        },
        cancel: () => fail(new DockerError("Cancelled.", { cancelled: true }), "term"),
      });
      if (options.input !== undefined) void write(procId, options.input, true).catch(() => {});
    });
    if (outcome.code === 0 || (options.ok ?? []).includes(outcome.code ?? -1)) return outcome;
    throw new DockerError(explain(args, outcome), outcome);
  };

  /**
   * Start a long-running docker and hand its output over line by line; the handle stops it and
   * writes to its stdin. `onExit` hears how it ended, also after a stop.
   * @param {string[]} args @param {StreamOptions} options @returns {Promise<StreamHandle>}
   */
  const stream = async (args, options) => {
    const { procId } = await spawn(args, options.cwd);
    const split = { stdout: lines(), stderr: lines() };
    /** @type {string[]} */
    const tail = [];
    let ended = false;
    adopt(procId, {
      feed: (event) => {
        if (event.event === "proc.output") {
          const which = event.data.stream === "stderr" ? "stderr" : "stdout";
          for (const line of split[which].push(event.data.data, event.data.encoding)) {
            if (which === "stderr" && tail.push(line) > 3) tail.shift();
            options.onLine(which, line);
          }
        } else if (event.event === "proc.exit") {
          ended = true;
          jobs.delete(procId);
          for (const which of /** @type {const} */ (["stdout", "stderr"])) {
            const rest = split[which].end();
            if (rest !== undefined) options.onLine(which, rest);
          }
          options.onExit?.({
            code: event.data.code ?? null,
            signal: event.data.signal ?? null,
            stdout: "",
            stderr: tail.join("\n"),
          });
        }
      },
    });
    return {
      procId,
      stop: async () => {
        if (!ended) await kill(procId, "term");
      },
      write: async (data, close = false) => {
        if (!ended) await write(procId, data, close);
      },
    };
  };

  /** Stop every running command (a pull or a build that takes too long); streams keep going. */
  const cancel = () => {
    for (const job of [...jobs.values()]) job.cancel?.();
  };

  return { run, stream, cancel, running: () => running };
}

/** Bytes gathered in order, decoded once at the end so a split character still reads right. */
function sink() {
  /** @type {Uint8Array[]} */
  const chunks = [];
  const self = {
    size: 0,
    push(/** @type {Uint8Array} */ bytes) {
      chunks.push(bytes);
      self.size += bytes.length;
    },
    text() {
      const all = new Uint8Array(self.size);
      let at = 0;
      for (const chunk of chunks) {
        all.set(chunk, at);
        at += chunk.length;
      }
      return new TextDecoder("utf-8").decode(all);
    },
  };
  return self;
}

/** Splits a stream into lines as it arrives; base64 chunks go through a streaming decoder. */
export function lines() {
  const decoder = new TextDecoder("utf-8");
  let rest = "";
  const cut = (/** @type {string} */ line) =>
    (line.endsWith("\r") ? line.slice(0, -1) : line).slice(0, LINE_LIMIT);
  return {
    /** @param {string} data @param {"utf8" | "base64"} encoding */
    push(data, encoding) {
      rest += encoding === "utf8" ? data : decoder.decode(decode(data, "base64"), { stream: true });
      const parts = rest.split("\n");
      rest = parts.pop() ?? "";
      if (rest.length > LINE_LIMIT) {
        parts.push(rest);
        rest = "";
      }
      return parts.map(cut);
    },
    end() {
      const last = rest + decoder.decode();
      rest = "";
      return last === "" ? undefined : cut(last);
    },
  };
}

/** @param {string} data @param {"utf8" | "base64" | undefined} encoding */
function decode(data, encoding) {
  if (encoding === "utf8") return new TextEncoder().encode(data);
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
