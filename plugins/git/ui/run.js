// Runs the git program through the bridge: `proc.spawn` without a shell, output gathered from
// `proc.output` events by process id until `proc.exit`, a timeout and a cancel that kill, and one
// ask with `perm.request` when the grant is missing. Every failure is an Error whose message is the
// sentence the person reads. Output that arrives before the spawn answer names its process is kept.

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginBridge} PluginBridge
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {{ code: number | null, signal: string | null, stdout: string, stderr: string }} Outcome
 * @typedef {{ cwd?: string, timeoutMs?: number, ok?: number[] }} RunOptions
 * @typedef {{ chunks: Uint8Array[], size: number }} Sink
 * @typedef {{ out: Sink, err: Sink, timer: ReturnType<typeof setTimeout> | undefined, settle(outcome: Outcome): void, fail(error: Error, signal?: "term" | "kill"): void }} Job
 */

/** The scope every call carries: the git program, no PTY. */
export const GIT_SCOPE = Object.freeze({ permission: "proc:spawn", commands: ["git"] });

/** No prompts (a missing credential fails at once), no optional locks, English messages. */
export const GIT_ENV = Object.freeze({
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
  LC_ALL: "C",
});

/** Put before every command: no pager, no colour codes, UTF-8 paths as they are. */
export const GIT_FLAGS = Object.freeze([
  "--no-pager",
  "-c",
  "color.ui=never",
  "-c",
  "core.quotepath=false",
]);

export const DEFAULT_TIMEOUT_MS = 30_000;
const OUTPUT_LIMIT = 8 * 1024 * 1024;
const EARLY_PROCS = 32;

/** git ended with a failure, a timeout or a cancel; `outcome` holds what it said. */
export class GitError extends Error {
  /**
   * @param {string} message
   * @param {Partial<Outcome> & { cancelled?: boolean }} [outcome]
   */
  constructor(message, outcome = {}) {
    super(message);
    this.name = "GitError";
    this.outcome = outcome;
    this.cancelled = outcome.cancelled === true;
  }
}

/**
 * @param {Pick<PluginBridge, "call" | "onEvent">} bridge
 * @param {{ onBusy?(running: number): void, reason?(cwd: string | undefined): string }} [options]
 */
export function createRunner(bridge, options = {}) {
  const onBusy = options.onBusy ?? (() => {});
  const reason = options.reason ?? ((cwd) => (cwd ? `To run git in ${cwd}` : "To run git"));
  /** @type {Map<string, Job>} */
  const jobs = new Map();
  /** Events for processes whose spawn answer has not arrived yet. @type {Map<string, BridgeEvent[]>} */
  const early = new Map();

  const feed = (/** @type {Job} */ job, /** @type {BridgeEvent} */ event) => {
    if (event.event === "proc.output") {
      const sink = event.data.stream === "stderr" ? job.err : job.out;
      const bytes = decode(event.data.data, event.data.encoding);
      sink.chunks.push(bytes);
      sink.size += bytes.length;
      if (job.out.size + job.err.size > OUTPUT_LIMIT) {
        job.fail(new GitError("git wrote more than 8 MiB; the output was dropped."));
      }
    } else if (event.event === "proc.exit") {
      job.settle({
        code: event.data.code ?? null,
        signal: event.data.signal ?? null,
        stdout: text(job.out),
        stderr: text(job.err),
      });
    }
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
   * Start git once; when the grant is missing, ask once and try again.
   * @param {string[]} args
   * @param {string | undefined} cwd
   */
  const spawn = async (args, cwd) => {
    const params = {
      command: "git",
      args: [...GIT_FLAGS, ...args],
      ...(cwd ? { cwd } : {}),
      env: { ...GIT_ENV },
      scope: { ...GIT_SCOPE, commands: [...GIT_SCOPE.commands] },
    };
    try {
      return await bridge.call("proc.spawn", params);
    } catch (error) {
      const code = codeOf(error);
      if (code === "unsupported")
        throw new GitError("This desk cannot run programs yet: proc.spawn is unsupported.");
      if (code !== "permission_denied") throw new GitError(`Could not run git: ${code}.`);
    }
    const decision = await bridge
      .call("perm.request", { permission: params.scope, reason: reason(cwd) })
      .catch(() => ({ granted: false }));
    if (!decision.granted) throw new GitError("Not allowed to run git.");
    try {
      return await bridge.call("proc.spawn", params);
    } catch (error) {
      throw new GitError(`Could not run git: ${codeOf(error)}.`);
    }
  };

  const kill = (/** @type {string} */ procId, /** @type {"term" | "kill"} */ signal) =>
    bridge
      .call("proc.kill", { procId, signal, scope: { ...GIT_SCOPE, commands: ["git"] } })
      .catch(() => {});

  /**
   * Run git with `args` and resolve with what it wrote. A non-zero exit rejects with a `GitError`
   * whose message is git's own, unless `ok` lists the code. `timeoutMs: 0` waits as long as it takes.
   * @param {string[]} args
   * @param {RunOptions} [options]
   * @returns {Promise<Outcome>}
   */
  const run = async (args, options = {}) => {
    const { procId } = await spawn(args, options.cwd);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const outcome = await new Promise((resolve, reject) => {
      /** @type {Job} */
      const job = {
        out: { chunks: [], size: 0 },
        err: { chunks: [], size: 0 },
        timer: undefined,
        settle: (outcome) => {
          finish();
          resolve(outcome);
        },
        fail: (error, signal = "kill") => {
          finish();
          void kill(procId, signal);
          reject(error);
        },
      };
      const finish = () => {
        if (!jobs.delete(procId)) return;
        if (job.timer !== undefined) clearTimeout(job.timer);
        onBusy(jobs.size);
      };
      jobs.set(procId, job);
      onBusy(jobs.size);
      if (timeoutMs > 0) {
        job.timer = setTimeout(() => {
          const seconds = timeoutMs / 1000;
          job.fail(new GitError(`git ${args[0] ?? ""} took longer than ${seconds} s.`), "term");
        }, timeoutMs);
      }
      for (const event of early.get(procId) ?? []) feed(job, event);
      early.delete(procId);
    });
    if (outcome.code === 0 || (options.ok ?? []).includes(outcome.code ?? -1)) return outcome;
    throw new GitError(explain(args, outcome), outcome);
  };

  /** Stop every running process (a fetch or push that takes too long). */
  const cancel = () => {
    for (const job of jobs.values())
      job.fail(new GitError("Cancelled.", { cancelled: true }), "term");
  };

  return { run, cancel, running: () => jobs.size };
}

/** What git said, without its `fatal:` and `error:` prefixes, or a plain line about the exit. */
export function explain(/** @type {string[]} */ args, /** @type {Outcome} */ outcome) {
  const said = outcome.stderr
    .split("\n")
    .map((line) => line.replace(/^(fatal|error|warning): /, "").trim())
    .filter((line) => line !== "" && !line.startsWith("hint:"));
  if (said.length > 0) return said.slice(0, 3).join(" ");
  const how = outcome.signal ? `was ended by ${outcome.signal}` : `exited with ${outcome.code}`;
  return `git ${args[0] ?? ""} ${how}.`;
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
