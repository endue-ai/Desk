// Logs of a container (`docker logs`) or a Compose project (`docker compose logs`): a stream that
// follows, or one read, split into lines with their stream, time and service, ANSI codes removed,
// kept in a ring of at most `max` lines. No DOM: the view gets a model whose `first` says how many
// lines have dropped off the front, so it appends what is new instead of drawing everything again.

import { stripAnsi } from "./errors.js";

/**
 * @typedef {import("./run.js").Stream} Stream
 * @typedef {{ kind: "container", id: string, name: string } | { kind: "project", name: string }} LogTarget
 * @typedef {{ n: number, stream: Stream, time: string, source: string, text: string }} LogLine
 * @typedef {{ title: string, target: LogTarget | null, lines: LogLine[], first: number,
 *   follow: boolean, running: boolean, ended: string, generation: number }} LogModel
 * @typedef {{ run: ReturnType<typeof import("./run.js").createRunner>["run"],
 *   stream: ReturnType<typeof import("./run.js").createRunner>["stream"] }} Runner
 */

const TIME = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\s?(.*)$/;
const PREFIX = /^(\S+)\s+\| ?(.*)$/;

/** The base of every compose call for a project: no colours, the project by name. */
export function composeBase(/** @type {string} */ project) {
  return ["compose", "--ansi", "never", "-p", project];
}

/**
 * The arguments that read a target's logs: with timestamps, the last `tail` lines, following or not.
 * @param {LogTarget} target
 * @param {{ tail: number, follow: boolean, since?: string }} options
 */
export function logArgs(target, { tail, follow, since }) {
  const common = [
    "--timestamps",
    "--tail",
    String(tail),
    ...(since ? ["--since", since] : []),
    ...(follow ? ["--follow"] : []),
  ];
  if (target.kind === "container") return ["logs", ...common, "--", target.id];
  return [...composeBase(target.name), "logs", "--no-color", ...common];
}

/**
 * One line as docker wrote it: a project's lines start with "service-1  | ", every line with its
 * RFC 3339 time.
 * @param {string} raw
 * @param {Stream} stream
 * @param {boolean} prefixed
 * @returns {Omit<LogLine, "n">}
 */
export function parseLine(raw, stream, prefixed) {
  let rest = stripAnsi(raw);
  let source = "";
  if (prefixed) {
    const found = PREFIX.exec(rest);
    if (found) {
      source = found[1] ?? "";
      rest = found[2] ?? "";
    }
  }
  const timed = TIME.exec(rest);
  return {
    stream,
    time: timed ? (timed[1] ?? "") : "",
    source,
    text: timed ? (timed[2] ?? "") : rest,
  };
}

/**
 * Where a project's compose runs: at the root, so a compose file in the desk's working folder is
 * never read for a project named by its labels.
 */
const where = (/** @type {LogTarget} */ target) => (target.kind === "project" ? { cwd: "/" } : {});

/** Whether a line shows under a filter: every word, in any case, in its source or text. */
export function matches(/** @type {LogLine} */ line, /** @type {string} */ filter) {
  if (filter === "") return true;
  const hay = `${line.source} ${line.text}`.toLowerCase();
  return filter
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

/** The title of a logs buffer. */
export const titleOf = (/** @type {LogTarget} */ target) =>
  target.kind === "container" ? `docker logs: ${target.name}` : `compose logs: ${target.name}`;

/**
 * @param {object} deps
 * @param {Runner} deps.runner
 * @param {(model: LogModel) => void} deps.onChange Called at most once per `flushMs`.
 * @param {() => { tail: number, max: number }} deps.limits
 * @param {number} [deps.flushMs]
 */
export function createLogs({ runner, onChange, limits, flushMs = 50 }) {
  /** @type {LogModel} */
  let model = {
    title: "",
    target: null,
    lines: [],
    first: 0,
    follow: false,
    running: false,
    ended: "",
    generation: 0,
  };
  /** @type {{ stop(): Promise<void> } | null} */
  let handle = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  let next = 0;

  const flush = () => {
    timer = null;
    onChange(model);
  };
  const changed = () => {
    if (timer === null) timer = setTimeout(flush, flushMs);
  };

  const push = (/** @type {Omit<LogLine, "n">} */ line) => {
    model.lines.push({ n: next++, ...line });
    const { max } = limits();
    // Trim in steps, so a long follow does not shift the array on every line.
    if (model.lines.length > max + Math.max(16, Math.floor(max / 10))) {
      const drop = model.lines.length - max;
      model.lines.splice(0, drop);
      model.first += drop;
    }
    changed();
  };

  const stop = async () => {
    const running = handle;
    handle = null;
    model.running = false;
    await running?.stop();
  };

  /**
   * Show a target's logs from its last `tail` lines, following them when `follow` is set.
   * @param {LogTarget} target
   * @param {{ follow: boolean, tail?: number }} options
   */
  const open = async (target, options) => {
    await stop();
    const generation = model.generation + 1;
    model = {
      title: titleOf(target),
      target,
      lines: [],
      first: 0,
      follow: options.follow,
      running: true,
      ended: "",
      generation,
    };
    next = 0;
    onChange(model);
    const prefixed = target.kind === "project";
    const tail = options.tail ?? limits().tail;
    /** @type {{ stop(): Promise<void> }} */
    let started;
    try {
      started = await runner.stream(logArgs(target, { tail, follow: options.follow }), {
        ...where(target),
        onLine: (stream, raw) => {
          if (model.generation === generation) push(parseLine(raw, stream, prefixed));
        },
        onExit: (outcome) => {
          if (model.generation !== generation) return;
          handle = null;
          model.running = false;
          model.ended = endedWith(outcome, options.follow);
          changed();
        },
      });
    } catch (error) {
      model.running = false;
      model.ended = error instanceof Error ? error.message : String(error);
      onChange(model);
      throw error;
    }
    // Another open came first: this stream is not wanted any more.
    if (model.generation !== generation) await started.stop();
    else handle = started;
  };

  /** Follow again from where the logs are, or stop following. */
  const setFollow = async (/** @type {boolean} */ follow) => {
    if (!model.target) throw new Error("No logs are open.");
    if (!follow) {
      model.follow = false;
      await stop();
      model.ended = "Stopped following.";
      onChange(model);
      return;
    }
    const target = model.target;
    await open(target, { follow: true, tail: limits().tail });
  };

  /** Forget the lines on screen; a follow goes on. */
  const clear = () => {
    model.first += model.lines.length;
    model.lines = [];
    onChange(model);
  };

  return { open, stop, setFollow, clear, model: () => model };
}

/** The line under the logs once the stream ends. */
function endedWith(
  /** @type {import("./run.js").Outcome} */ outcome,
  /** @type {boolean} */ follow,
) {
  if (outcome.signal) return follow ? "Stopped following." : "";
  if (outcome.code !== 0) {
    const said = outcome.stderr.split("\n").map(stripAnsi).filter(Boolean).pop() ?? "";
    return (
      said.replace(/^(error response from daemon|error):\s*/i, "") ||
      `docker exited with ${outcome.code}.`
    );
  }
  return follow ? "The container stopped: the logs end here." : "";
}

/**
 * Read a target's last lines once, both streams in time order, for agents: `tail` lines (200 when
 * absent, 10 000 at most), `since` a duration or a time.
 * @param {Pick<Runner, "run">} runner
 * @param {LogTarget} target
 * @param {{ tail?: unknown, since?: unknown }} args
 */
export async function readLogs(runner, target, args) {
  const tail = Number.isInteger(args.tail) ? Math.min(Number(args.tail), 10_000) : 200;
  const since = typeof args.since === "string" && args.since !== "" ? args.since : undefined;
  const outcome = await runner.run(
    logArgs(target, { tail, follow: false, ...(since ? { since } : {}) }),
    {
      ...where(target),
      timeoutMs: 30_000,
    },
  );
  const prefixed = target.kind === "project";
  /** @type {Omit<LogLine, "n">[]} */
  const all = [];
  for (const [stream, text] of /** @type {const} */ ([
    ["stdout", outcome.stdout],
    ["stderr", outcome.stderr],
  ])) {
    for (const raw of text.split("\n")) if (raw !== "") all.push(parseLine(raw, stream, prefixed));
  }
  // Stable: lines with the same time keep their stream's order.
  return all.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}
