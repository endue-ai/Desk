// Git Studio's runner, the same contract as endue.git's (plugins have no shared code, so it is kept
// here in full). Runs a scoped program through the bridge: `proc.spawn` without a shell, output gathered from
// `proc.output` events by process id until `proc.exit`, a timeout and a cancel that kill, and one
// ask with `perm.request` when the grant is missing. Every failure is an Error whose message is the
// sentence the person reads. Output that arrives before the spawn answer names its process is kept.

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginBridge} PluginBridge
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {{ code: number | null, signal: string | null, stdout: string, stderr: string }} Outcome
 * @typedef {"git" | "gh" | "glab"} Program
 * @typedef {{ cwd?: string, timeoutMs?: number, ok?: number[], input?: string, program?: Program }} RunOptions
 *   `input` is written to stdin, which then closes (`proc.write` with `close`).
 * @typedef {{ chunks: Uint8Array[], size: number }} Sink
 * @typedef {{ program: Program, out: Sink, err: Sink, timer: ReturnType<typeof setTimeout> | undefined, settle(outcome: Outcome): void, fail(error: Error, signal?: "term" | "kill"): void }} Job
 */

/** The default program scope, with no PTY. */
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

const CLI_ENV = Object.freeze({
  gh: { GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", GH_DEBUG: "" },
  glab: {
    GLAB_NO_PROMPT: "1",
    GLAB_CHECK_UPDATE: "0",
    GLAB_DEBUG: "false",
    GLAB_DEBUG_HTTP: "false",
  },
});

// A Finder-launched app may miss Homebrew. Try common Unix install folders after PATH fails.
const CLI_PATH_FALLBACK =
  "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/snap/bin:/home/linuxbrew/.linuxbrew/bin";

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
  /** @type {Map<Program, Promise<{ granted: boolean }>>} */
  const grants = new Map();
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
        job.fail(
          new GitError(`${job.program} wrote more than 8 MiB. Try again with a smaller result.`),
        );
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
   * Start the program once. Share the permission request across concurrent reads.
   * @param {string[]} args
   * @param {string | undefined} cwd
   * @param {Program} program
   */
  const spawn = async (args, cwd, program) => {
    const params = {
      command: program,
      args: program === "git" ? [...GIT_FLAGS, ...args] : args,
      ...(cwd ? { cwd } : {}),
      env: program === "git" ? { ...GIT_ENV } : { ...CLI_ENV[program], NO_COLOR: "1" },
      scope: scopeOf(program),
    };
    const start = async () => {
      try {
        return await bridge.call("proc.spawn", params);
      } catch (error) {
        if (
          program === "git" ||
          codeOf(error) !== "not_found" ||
          globalThis.navigator?.platform?.startsWith("Win")
        )
          throw error;
        return bridge.call("proc.spawn", {
          ...params,
          env: { ...params.env, PATH: CLI_PATH_FALLBACK },
        });
      }
    };
    try {
      return await start();
    } catch (error) {
      const code = codeOf(error);
      if (code === "unsupported")
        throw new GitError("This desk cannot run programs yet: proc.spawn is unsupported.");
      if (code !== "permission_denied") throw spawnError(program, code);
    }
    let request = grants.get(program);
    if (!request) {
      const reason =
        program === "git"
          ? (options.reason?.(cwd) ?? (cwd ? `To run git in ${cwd}` : "To run git"))
          : `To access origin through the authenticated ${program} CLI`;
      request = bridge
        .call("perm.request", { permission: params.scope, reason })
        .catch(() => ({ granted: false }))
        .finally(() => grants.delete(program));
      grants.set(program, request);
    }
    if (!(await request).granted) throw new GitError(`Not allowed to run ${program}.`);
    try {
      return await start();
    } catch (error) {
      throw spawnError(program, codeOf(error));
    }
  };

  const kill = (
    /** @type {string} */ procId,
    /** @type {"term" | "kill"} */ signal,
    /** @type {Program} */ program,
  ) => bridge.call("proc.kill", { procId, signal, scope: scopeOf(program) }).catch(() => {});

  /**
   * Run the program with `args` and resolve with what it wrote. A non-zero exit rejects with a
   * `GitError` unless `ok` lists the code. `timeoutMs: 0` waits as long as it takes.
   * @param {string[]} args
   * @param {RunOptions} [options]
   * @returns {Promise<Outcome>}
   */
  const run = async (args, options = {}) => {
    const program = options.program ?? "git";
    const { procId } = await spawn(args, options.cwd, program);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const outcome = await new Promise((resolve, reject) => {
      /** @type {Job} */
      const job = {
        program,
        out: { chunks: [], size: 0 },
        err: { chunks: [], size: 0 },
        timer: undefined,
        settle: (outcome) => {
          finish();
          resolve(outcome);
        },
        fail: (error, signal = "kill") => {
          finish();
          void kill(procId, signal, program);
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
          job.fail(
            new GitError(`${program} ${args[0] ?? ""} took longer than ${seconds} s.`),
            "term",
          );
        }, timeoutMs);
      }
      for (const event of early.get(procId) ?? []) feed(job, event);
      early.delete(procId);
      if (options.input !== undefined) {
        const scope = scopeOf(program);
        bridge
          .call("proc.write", { procId, data: options.input, close: true, scope })
          .catch((error) =>
            job.fail(new GitError(`Could not hand ${program} its input: ${codeOf(error)}.`)),
          );
      }
    });
    if (outcome.code === 0 || (options.ok ?? []).includes(outcome.code ?? -1)) return outcome;
    throw new GitError(explain(args, outcome, program), outcome);
  };

  /** Stop every running process (a fetch or push that takes too long). */
  const cancel = () => {
    for (const job of jobs.values())
      job.fail(new GitError("Cancelled.", { cancelled: true }), "term");
  };

  return { run, cancel, running: () => jobs.size };
}

/** What git said, without its `fatal:` and `error:` prefixes, or a plain line about the exit. */
export function explain(
  /** @type {string[]} */ args,
  /** @type {Outcome} */ outcome,
  /** @type {Program} */ program = "git",
) {
  const conflict = outcome.stdout.split("\n").find((line) => line.startsWith("CONFLICT "));
  if (conflict) return conflict;
  const said = outcome.stderr
    .split("\n")
    .map((line) => line.replace(/^(fatal|error|warning): /, "").trim())
    .filter((line) => line !== "" && !line.startsWith("hint:"));
  if (said.length > 0) return said.slice(0, 3).join(" ");
  const how = outcome.signal ? `was ended by ${outcome.signal}` : `exited with ${outcome.code}`;
  return `${program} ${args[0] ?? ""} ${how}.`;
}

const scopeOf = (/** @type {Program} */ program) => ({ ...GIT_SCOPE, commands: [program] });

function spawnError(/** @type {Program} */ program, /** @type {string} */ code) {
  return new GitError(
    program !== "git" && code === "not_found"
      ? `Could not find ${program}. Install it on Desk's PATH, sign in with ${program} auth login, and refresh.`
      : `Could not run ${program}: ${code}.`,
  );
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
