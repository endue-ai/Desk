// Every question in flight or answered this session, whichever view asked it: the Activity view's
// rows, and what stops them. A run's answer grows while the program streams.

import { ask } from "./ask.js";

/**
 * @typedef {import("./ask.js").Question} Question
 * @typedef {import("./ask.js").Result} Result
 * @typedef {"chat" | "compare" | "board" | "command"} Origin
 * @typedef {{ id: string, agent: string, name: string, origin: Origin, prompt: string,
 *   started: number, ended: number, ending: "running" | import("./ask.js").Ending,
 *   answer: string, error: string, line: string, problems: string[],
 *   tools: import("./parse.js").Reply["tools"], usage: import("./parse.js").Reply["usage"],
 *   session: string, model: string }} Run
 */

const RUNS_KEPT = 100;

/**
 * @param {import("./ask.js").Runner} runner
 * @param {{ now(): number, id(): string, onChange(run: Run): void, plain?: Set<string> }} env
 */
export function createRuns(runner, env) {
  /** @type {Run[]} */
  let runs = [];
  /** @type {Map<string, () => void>} */
  const stops = new Map();

  /**
   * Ask, as a run of `origin`.
   * @param {Question} question
   * @param {Origin} origin
   * @returns {{ run: Run, done: Promise<Result> }}
   */
  const start = (question, origin) => {
    /** @type {Run} */
    const run = {
      id: env.id(),
      agent: question.agent.id,
      name: question.agent.name,
      origin,
      prompt: question.prompt,
      started: env.now(),
      ended: 0,
      ending: "running",
      answer: "",
      error: "",
      line: question.agent.command,
      problems: [],
      tools: [],
      usage: {},
      session: "",
      model: question.model ?? "",
    };
    runs.push(run);
    const finished = runs.filter((r) => r.ending !== "running");
    if (runs.length > RUNS_KEPT && finished[0]) runs = runs.filter((r) => r !== finished[0]);
    const asked = ask(runner, question, {
      ...(env.plain ? { plain: env.plain } : {}),
      onUpdate: (reply) => {
        run.answer = reply.text.trim() || reply.final.trim();
        run.tools = [...reply.tools];
        run.usage = { ...reply.usage };
        run.problems = [...reply.problems];
        if (reply.session) run.session = reply.session;
        if (reply.model) run.model = reply.model;
        env.onChange(run);
      },
    });
    stops.set(run.id, asked.stop);
    env.onChange(run);
    const done = asked.done.then((result) => {
      stops.delete(run.id);
      Object.assign(run, {
        ending: result.ending,
        ended: env.now(),
        answer: result.answer,
        error: result.error,
        line: result.line,
        tools: [...result.reply.tools],
        usage: { ...result.reply.usage },
        problems: [...result.reply.problems],
        session: result.reply.session || run.session,
        model: result.reply.model || run.model,
      });
      env.onChange(run);
      return result;
    });
    return { run, done };
  };

  /** Stop one run; false when it is not running. */
  const stop = (/** @type {string} */ id) => {
    const fn = stops.get(id);
    fn?.();
    return fn !== undefined;
  };

  /** Stop every run, or every run of one origin. */
  const stopAll = (/** @type {Origin | undefined} */ origin) => {
    let n = 0;
    for (const run of runs)
      if (run.ending === "running" && (!origin || run.origin === origin) && stop(run.id)) n++;
    return n;
  };

  return {
    start,
    stop,
    stopAll,
    find: (/** @type {unknown} */ id) => runs.find((r) => r.id === id),
    /** Newest first. */
    list: () => [...runs].reverse(),
    running: () => runs.filter((r) => r.ending === "running"),
  };
}
