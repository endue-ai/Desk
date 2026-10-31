// Runs the docker program through the bridge: `proc.spawn` without a shell, the context the person
// picked as a global flag, output gathered from `proc.output` events by process id until `proc.exit`,
// a timeout and a cancel that kill, and one ask with `perm.request` when the grant is missing. Long
// processes (logs -f, events) are streams: their output arrives line by line until they are stopped.
// Every failure is a DockerError whose message is the sentence the person reads.

import { explain, kindOf } from "./errors.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginBridge} PluginBridge
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {{ code: number | null, signal: string | null, stdout: string, stderr: string }} Outcome
 * @typedef {{ cwd?: string, timeoutMs?: number, ok?: number[] }} RunOptions
 * @typedef {"stdout" | "stderr"} Stream
 * @typedef {{ cwd?: string, onLine(stream: Stream, line: string): void, onExit?(outcome: Outcome): void }} StreamOptions
 * @typedef {{ procId: string, stop(): Promise<void> }} StreamHandle
 * @typedef {{ feed(event: BridgeEvent): void, cancel?(): void }} Job
 */

/** The scope every call carries: the docker program, no PTY. */
export const DOCKER_SCOPE = Object.freeze({ permission: "proc:spawn", commands: ["docker"] });

/** No "What's next" hints after a command. */
export const DOCKER_ENV = Object.freeze({ DOCKER_CLI_HINTS: "false" });

/**
 * Where docker is installed when the desk's own PATH misses it (an app started from the Finder gets
 * the system's PATH, not the shell's): Homebrew, Docker Desktop's and OrbStack's app bundles, the
 * system folders. Tried once when docker is not found and no PATH is set.
 */
export const FALLBACK_PATH = [
  "/usr/local/bin",
  "/opt/homebrew/bin",
  "/Applications/Docker.app/Contents/Resources/bin",
  "/Applications/OrbStack.app/Contents/MacOS/xbin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
  "/snap/bin",
].join(":");

export const DEFAULT_TIMEOUT_MS = 15_000;
const OUTPUT_LIMIT = 8 * 1024 * 1024;
const EARLY_PROCS = 32;
/** A line longer than this is cut, so one runaway line cannot hold the whole stream. */
const LINE_LIMIT = 64 * 1024;

/** docker ended with a failure, a timeout or a cancel; `outcome` holds what it said. */
export class DockerError extends Error {
  /**
   * @param {string} message
   * @param {Partial<Outcome> & { cancelled?: boolean, kind?: string }} [outcome]
   */
  constructor(message, outcome = {}) {
    super(message);
    this.name = "DockerError";
    this.outcome = outcome;
    this.cancelled = outcome.cancelled === true;
    /** What went wrong, for the header: missing, unsupported, denied, daemon, socket, compose. */
    this.kind = outcome.kind ?? kindOf(outcome.stderr ?? "");
  }
}

/** The flags before every subcommand: the context, when one is picked. */
export function globalFlags(/** @type {string} */ context) {
  return context ? ["--context", context] : [];
}

/**
 * @param {Pick<PluginBridge, "call" | "onEvent">} bridge
 * @param {{ onBusy?(running: number): void, context?(): string, path?(): string }} [options]
 *   `path` is the PATH docker is looked up on and runs with; "" keeps the desk's.
 */
export function createRunner(bridge, options = {}) {
  const onBusy = options.onBusy ?? (() => {});
  const context = options.context ?? (() => "");
  const path = options.path ?? (() => "");
  /** Set once docker was found only on FALLBACK_PATH. */
  let fallback = false;
  /** @type {Map<string, Job>} */
  const jobs = new Map();
  /** Jobs that count as busy (runs, not streams). */
  let running = 0;
  /** Events for processes whose spawn answer has not arrived yet. @type {Map<string, BridgeEvent[]>} */
  const early = new Map();

  bridge.onEvent((event) => {
    if (event.event !== "proc.output" && event.event !== "proc.exit") return;
    const job = jobs.get(event.data.procId);
    if (job) {
      job.feed(event);
      return;
    }
    const kept = early.get(event.data.procId) ?? [];
    kept.push(event);
    early.set(event.data.procId, kept);
    const oldest = early.keys().next().value;
    if (early.size > EARLY_PROCS && oldest !== undefined) early.delete(oldest);
  });

  /** Hand a new job the events that came before its spawn answer. */
  const adopt = (/** @type {string} */ procId, /** @type {Job} */ job) => {
    jobs.set(procId, job);
    for (const event of early.get(procId) ?? []) job.feed(event);
    early.delete(procId);
  };

  /**
   * Start docker once; when the grant is missing, ask once and try again.
   * @param {string[]} args
   * @param {string | undefined} cwd
   * @returns {Promise<{ procId: string }>}
   */
  const spawn = async (args, cwd) => {
    const chosen = path() || (fallback ? FALLBACK_PATH : "");
    const params = {
      command: "docker",
      args: [...globalFlags(context()), ...args],
      ...(cwd ? { cwd } : {}),
      env: { ...DOCKER_ENV, ...(chosen ? { PATH: chosen } : {}) },
      scope: { ...DOCKER_SCOPE, commands: [...DOCKER_SCOPE.commands] },
    };
    const refused = (/** @type {unknown} */ error) => {
      const code = codeOf(error);
      if (code === "unsupported")
        return new DockerError("This desk cannot run programs yet: proc.spawn is unsupported.", {
          kind: "unsupported",
        });
      if (code === "not_found")
        return new DockerError(
          "The docker program is not on PATH: install Docker Desktop, Colima, OrbStack or the docker CLI, or set endue.docker.path to the folders it is in.",
          { kind: "missing" },
        );
      return new DockerError(`Could not run docker: ${code}.`);
    };
    try {
      return await bridge.call("proc.spawn", params);
    } catch (error) {
      if (codeOf(error) === "not_found" && !chosen) {
        // Not on the desk's PATH: look where docker is usually installed, once.
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
      .call("perm.request", { permission: params.scope, reason: "To run docker" })
      .catch(() => ({ granted: false }));
    if (!decision.granted) throw new DockerError("Not allowed to run docker.", { kind: "denied" });
    try {
      return await bridge.call("proc.spawn", params);
    } catch (error) {
      throw refused(error);
    }
  };

  const kill = (/** @type {string} */ procId, /** @type {"term" | "kill"} */ signal) =>
    bridge
      .call("proc.kill", { procId, signal, scope: { ...DOCKER_SCOPE, commands: ["docker"] } })
      .catch(() => {});

  /**
   * Run docker with `args` and resolve with what it wrote. A non-zero exit rejects with a
   * DockerError in plain words, unless `ok` lists the code. `timeoutMs: 0` waits as long as it takes.
   * @param {string[]} args
   * @param {RunOptions} [options]
   * @returns {Promise<Outcome>}
   */
  const run = async (args, options = {}) => {
    const { procId } = await spawn(args, options.cwd);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          const what = args.find((arg) => !arg.startsWith("-")) ?? "";
          fail(new DockerError(`docker ${what} took longer than ${timeoutMs / 1000} s.`), "term");
        }, timeoutMs);
      }
      adopt(procId, {
        feed: (event) => {
          if (event.event === "proc.output") {
            const bytes = decode(event.data.data, event.data.encoding);
            (event.data.stream === "stderr" ? err : out).push(bytes);
            if (out.size + err.size > OUTPUT_LIMIT)
              fail(
                new DockerError("docker wrote more than 8 MiB; the output was dropped."),
                "kill",
              );
          } else if (event.event === "proc.exit" && finish()) {
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
    });
    if (outcome.code === 0 || (options.ok ?? []).includes(outcome.code ?? -1)) return outcome;
    throw new DockerError(explain(args, outcome), outcome);
  };

  /**
   * Start a long-running docker (logs -f, events) and hand its output over line by line. The
   * returned handle stops it; `onExit` hears how it ended, also after a stop.
   * @param {string[]} args
   * @param {StreamOptions} options
   * @returns {Promise<StreamHandle>}
   */
  const stream = async (args, options) => {
    const { procId } = await spawn(args, options.cwd);
    const splitters = { stdout: lines(), stderr: lines() };
    /** @type {string[]} */
    const tail = [];
    let ended = false;
    adopt(procId, {
      feed: (event) => {
        if (event.event === "proc.output") {
          const which = event.data.stream === "stderr" ? "stderr" : "stdout";
          for (const line of splitters[which].push(event.data.data, event.data.encoding)) {
            if (which === "stderr" && tail.push(line) > 3) tail.shift();
            options.onLine(which, line);
          }
        } else if (event.event === "proc.exit") {
          ended = true;
          jobs.delete(procId);
          for (const which of /** @type {const} */ (["stdout", "stderr"])) {
            const rest = splitters[which].end();
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
    };
  };

  /** Stop every running command (a pull or compose up that takes too long); streams keep going. */
  const cancel = () => {
    for (const job of [...jobs.values()]) job.cancel?.();
  };

  return { run, stream, cancel, running: () => running };
}

const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";

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
    /** What is left after the last newline, if anything. */
    end() {
      const last = rest + decoder.decode();
      rest = "";
      return last === "" ? undefined : cut(last);
    },
  };
}

/** @param {string} data @param {"utf8" | "base64"} encoding */
function decode(data, encoding) {
  if (encoding === "utf8") return new TextEncoder().encode(data);
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
