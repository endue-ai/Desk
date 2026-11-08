// Runs a client through the bridge: `proc.spawn` without a shell, output gathered from `proc.output`
// by process id until `proc.exit`, one ask with `perm.request` when the grant is missing, and a
// second try with the usual install folders on PATH when the program is not found. Stopping (a
// cancel, the timeout, enough rows, too much output) sends SIGINT first, which makes psql and mysql
// cancel the query on the server and sqlite3 interrupt it, then SIGKILL a second later: the mysql
// client carries on with the next statement when a killed query does not fail (SLEEP() returns 1).
// A non-zero exit is not an error here: the engine reads what the client said.

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginBridge} PluginBridge
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("./engines/common.js").Invocation} Invocation
 * @typedef {import("./engines/common.js").Outcome} Outcome
 * @typedef {{ chunks: Uint8Array[], size: number }} Sink
 * @typedef {{
 *   out: Sink, err: Sink, take(data: { stream: string, data: string, encoding: "utf8" | "base64" }): void,
 *   stop(flag: "stopped" | "cancelled" | "timedOut" | "overflow"): void,
 *   settle(data: { code?: number | null, signal?: string | null }): void,
 * }} Job
 */

export const OUTPUT_LIMIT = 64 * 1024 * 1024;
export const GRACE_MS = 1000;
const EARLY_PROCS = 32;

/** The client could not start: it is missing, not allowed, or the desk cannot run programs. */
export class RunError extends Error {
  /**
   * @param {string} message
   * @param {"missing" | "refused" | "client"} kind
   */
  constructor(message, kind) {
    super(message);
    this.name = "RunError";
    this.kind = kind;
  }
}

/**
 * @param {Pick<PluginBridge, "call" | "onEvent">} bridge
 * @param {{
 *   onBusy?(running: number): void,
 *   searchPath?(): string,
 *   now?(): number,
 *   setTimer?(fn: () => void, ms: number): unknown,
 *   clearTimer?(timer: unknown): void,
 * }} [options] `searchPath` is the PATH tried when a program is not found on the desk's own.
 */
export function createRunner(bridge, options = {}) {
  const onBusy = options.onBusy ?? (() => {});
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer =
    options.clearTimer ??
    ((timer) => clearTimeout(/** @type {ReturnType<typeof setTimeout>} */ (timer)));
  /** @type {Map<string, Job>} */
  const jobs = new Map();
  /** @type {Map<string, BridgeEvent[]>} */
  const early = new Map();
  /** Programs found only with the search path, so later runs use it at once. */
  const onSearchPath = new Set();

  const feed = (/** @type {Job} */ job, /** @type {BridgeEvent} */ event) => {
    if (event.event === "proc.output") job.take(event.data);
    else if (event.event === "proc.exit") job.settle(event.data);
  };

  bridge.onEvent((event) => {
    if (event.event !== "proc.output" && event.event !== "proc.exit") return;
    const job = jobs.get(event.data.procId);
    if (job) {
      feed(job, event);
      return;
    }
    const kept = early.get(event.data.procId) ?? [];
    kept.push(event);
    early.set(event.data.procId, kept);
    const oldest = early.keys().next().value;
    if (early.size > EARLY_PROCS && oldest !== undefined) early.delete(oldest);
  });

  /**
   * Start the client once; ask once for a missing grant; try the search path once for a missing
   * program.
   * @param {Invocation} invocation
   */
  const spawn = async (invocation) => {
    const { command } = invocation;
    const scope = { permission: /** @type {const} */ ("proc:spawn"), commands: [command] };
    const withPath = (/** @type {boolean} */ use) => {
      const path = options.searchPath?.() ?? "";
      const env =
        use && path && !invocation.env.PATH ? { ...invocation.env, PATH: path } : invocation.env;
      return {
        command,
        args: invocation.args,
        env,
        ...(invocation.cwd ? { cwd: invocation.cwd } : {}),
        scope: { ...scope, commands: [command] },
      };
    };
    let usePath = onSearchPath.has(command);
    let asked = false;
    for (;;) {
      try {
        const answer = await bridge.call("proc.spawn", withPath(usePath));
        if (usePath) onSearchPath.add(command);
        return answer;
      } catch (error) {
        const code = codeOf(error);
        if (code === "unsupported")
          throw new RunError(
            "This desk cannot run programs yet: proc.spawn is unsupported.",
            "client",
          );
        if (code === "not_found" && !usePath && options.searchPath?.()) {
          usePath = true;
          continue;
        }
        if (code === "not_found")
          throw new RunError(
            `${command} was not found. Install it, or set its path in the settings.`,
            "missing",
          );
        if (code !== "permission_denied" || asked)
          throw new RunError(`Could not run ${command}: ${code}.`, "refused");
      }
      asked = true;
      const decision = await bridge
        .call("perm.request", {
          permission: scope,
          reason: `To run ${command}, the database client`,
        })
        .catch(() => ({ granted: false }));
      if (!decision.granted) throw new RunError(`Not allowed to run ${command}.`, "refused");
    }
  };

  const kill = (
    /** @type {string} */ procId,
    /** @type {string} */ command,
    /** @type {"int" | "kill"} */ signal,
  ) =>
    bridge
      .call("proc.kill", {
        procId,
        signal,
        scope: { permission: "proc:spawn", commands: [command] },
      })
      .catch(() => {});

  /**
   * Run the client and resolve with what it wrote and how it ended.
   * @param {Invocation} invocation
   * @param {{ timeoutMs?: number }} [runOptions] `timeoutMs` 0 or absent waits as long as it takes.
   * @returns {Promise<Outcome>}
   */
  const run = async (invocation, runOptions = {}) => {
    const started = now();
    const { procId } = await spawn(invocation);
    const timeoutMs = runOptions.timeoutMs ?? 0;
    return new Promise((resolve) => {
      const flags = { stopped: false, cancelled: false, timedOut: false, overflow: false };
      /** @type {unknown[]} */
      const timers = [];
      let stopping = false;
      const decoder = new TextDecoder("utf-8");
      const { counter, stopAfter } = invocation;
      /** @type {Job} */
      const job = {
        out: { chunks: [], size: 0 },
        err: { chunks: [], size: 0 },
        take: (data) => {
          const bytes = decode(data.data, data.encoding);
          const sink = data.stream === "stderr" ? job.err : job.out;
          sink.chunks.push(bytes);
          sink.size += bytes.length;
          if (job.out.size + job.err.size > OUTPUT_LIMIT) job.stop("overflow");
          if (data.stream !== "stderr" && stopAfter > 0 && counter) {
            if (counter.feed(decoder.decode(bytes, { stream: true })) >= stopAfter)
              job.stop("stopped");
          }
        },
        stop: (flag) => {
          flags[flag] = true;
          if (stopping) return;
          stopping = true;
          void kill(procId, invocation.command, "int");
          timers.push(setTimer(() => void kill(procId, invocation.command, "kill"), GRACE_MS));
        },
        settle: (data) => {
          if (!jobs.delete(procId)) return;
          for (const timer of timers) clearTimer(timer);
          onBusy(jobs.size);
          resolve({
            code: data.code ?? null,
            signal: data.signal ?? null,
            stdout: text(job.out),
            stderr: text(job.err),
            ...flags,
            ms: now() - started,
          });
        },
      };
      jobs.set(procId, job);
      onBusy(jobs.size);
      if (timeoutMs > 0) timers.push(setTimer(() => job.stop("timedOut"), timeoutMs));
      for (const event of early.get(procId) ?? []) feed(job, event);
      early.delete(procId);
    });
  };

  /** Stop every running client. */
  const cancel = () => {
    for (const job of jobs.values()) job.stop("cancelled");
  };

  return { run, cancel, running: () => jobs.size };
}

const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";

/** @param {string} data @param {"utf8" | "base64"} encoding */
function decode(data, encoding) {
  if (encoding === "utf8") return new TextEncoder().encode(data);
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Decode once, at the end, so a character split across two chunks still reads right. */
function text(/** @type {Sink} */ sink) {
  const all = new Uint8Array(sink.size);
  let at = 0;
  for (const chunk of sink.chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }
  return new TextDecoder("utf-8").decode(all);
}
