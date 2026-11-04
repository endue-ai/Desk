// One question to one agent program, start to finish: the arguments the catalog gives, the output
// read into a reply as it streams, and two second tries. A conversation the program cannot resume
// (an expired session) is asked again with the earlier turns written into the prompt; a version
// that does not know the structured output flags is asked again for plain text, and remembered.

import { promptArg, withTranscript } from "./catalog.js";
import { answerOf, apply, emptyReply, reader } from "./parse.js";

/**
 * @typedef {import("./catalog.js").Agent} Agent
 * @typedef {import("./parse.js").Reply} Reply
 * @typedef {{ role: "user" | "agent", text: string }} Turn
 * @typedef {{ agent: Agent, prompt: string, session?: string, model?: string, readOnly: boolean,
 *   history?: Turn[], cwd?: string, timeoutMs?: number }} Question
 * @typedef {"done" | "failed" | "stopped"} Ending
 * @typedef {{ ending: Ending, reply: Reply, answer: string, error: string, line: string }} Result
 * @typedef {Pick<ReturnType<typeof import("./run.js").createRunner>, "start">} Runner
 */

/** What a program says when it does not know a flag the plugin passed. */
export const UNKNOWN_FLAG =
  /unknown (option|argument|flag)|unrecognized (option|argument)|unexpected argument|invalid values?:|no such option/i;

/** The agents whose installed version answered only in plain text, for this session. */
export const plainAgents = new Set();

/**
 * Ask, and resolve with the result. `onUpdate` hears the reply each time it grows.
 * @param {Runner} runner
 * @param {Question} question
 * @param {{ onUpdate?(reply: Reply): void, plain?: Set<string> }} [options]
 * @returns {{ done: Promise<Result>, stop(): void }}
 */
export function ask(runner, question, options = {}) {
  const plain = options.plain ?? plainAgents;
  const { agent } = question;
  let stopped = false;
  /** @type {(() => Promise<void>) | undefined} */
  let stopCurrent;

  /**
   * One run of the program.
   * @param {{ session: string, plain: boolean }} attempt
   */
  const once = async (attempt) => {
    const prompt = attempt.session
      ? question.prompt
      : withTranscript(question.history ?? [], question.prompt, agent.name);
    const args = agent.args({
      prompt,
      readOnly: question.readOnly,
      plain: attempt.plain,
      ...(attempt.session ? { session: attempt.session } : {}),
      ...(question.model ? { model: question.model } : {}),
    });
    const read = reader(attempt.plain ? "text" : agent.format);
    const reply = emptyReply();
    const feed = (/** @type {import("./parse.js").AgentEvent[]} */ events) => {
      if (events.length === 0) return;
      for (const event of events) apply(reply, event);
      options.onUpdate?.(reply);
    };
    const handle = await runner.start(agent.command, args, {
      ...(question.cwd ? { cwd: question.cwd } : {}),
      timeoutMs: question.timeoutMs ?? 0,
      onLine: (stream, line) => {
        if (stream === "stdout") feed(read.line(line));
      },
    });
    stopCurrent = handle.stop;
    if (stopped) void handle.stop();
    const outcome = await handle.done;
    feed(read.end());
    return { outcome, reply, line: commandLine(agent.command, args, promptArg(prompt)) };
  };

  const done = (async () => {
    const resumable = agent.resumes && question.session ? question.session : "";
    let attempt = { session: resumable, plain: plain.has(agent.id) };
    for (let tries = 0; ; tries++) {
      /** @type {Awaited<ReturnType<typeof once>>} */
      let ran;
      try {
        ran = await once(attempt);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return result("failed", emptyReply(), message, agent.command);
      }
      const { outcome, reply, line } = ran;
      const answer = answerOf(reply);
      if (stopped || outcome.stopped) return result("stopped", reply, "Stopped.", line);
      if (outcome.timedOut)
        return result(
          "failed",
          reply,
          `${agent.name} took longer than ${(question.timeoutMs ?? 0) / 1000} s.`,
          line,
        );
      const failed = outcome.code !== 0 || reply.fatal !== "";
      if (!failed) return result("done", reply, "", line);
      if (!answer && tries < 2) {
        if (attempt.session) {
          attempt = { ...attempt, session: "" };
          continue;
        }
        if (!attempt.plain && UNKNOWN_FLAG.test(outcome.stderr)) {
          plain.add(agent.id);
          attempt = { ...attempt, plain: true };
          continue;
        }
      }
      return result("failed", reply, failure(agent, outcome, reply), line);
    }
  })();

  return {
    done,
    stop() {
      stopped = true;
      void stopCurrent?.();
    },
  };
}

/**
 * @param {Ending} ending
 * @param {Reply} reply
 * @param {string} error
 * @param {string} line
 * @returns {Result}
 */
function result(ending, reply, error, line) {
  return { ending, reply, answer: answerOf(reply), error, line };
}

/** The sentence a failed run ends with: the agent's own error, its last stderr line, the code. */
function failure(
  /** @type {Agent} */ agent,
  /** @type {import("./run.js").Outcome} */ outcome,
  /** @type {Reply} */ reply,
) {
  if (reply.fatal) return reply.fatal;
  const said = outcome.stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  if (said) return `${agent.name}: ${said.length > 300 ? `${said.slice(0, 299)}…` : said}`;
  if (outcome.signal) return `${agent.name} was ended by ${outcome.signal}.`;
  return `${agent.name} exited with code ${outcome.code}.`;
}

/** The command as the activity shows it: the flags, with the prompt itself left out. */
function commandLine(
  /** @type {string} */ command,
  /** @type {string[]} */ args,
  /** @type {string} */ prompt,
) {
  const shown = args.map((arg) =>
    arg === prompt ? "<prompt>" : arg.startsWith("--prompt=") ? "--prompt=<prompt>" : arg,
  );
  return [command, ...shown].join(" ");
}
