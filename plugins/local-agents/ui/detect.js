// Which agent programs this computer has: each catalog program asked for its version, all at once.
// A program that is not on PATH is missing; one that is there but fails or hangs is broken, with
// what it said.

import { AGENTS, VERSION_ARGS, versionOf } from "./catalog.js";
import { AgentError } from "./run.js";

/**
 * @typedef {import("./catalog.js").Agent} Agent
 * @typedef {"checking" | "ready" | "missing" | "broken" | "denied" | "unsupported"} State
 * @typedef {{ id: string, name: string, vendor: string, command: string, install: string,
 *   guard: import("./catalog.js").Guard, guardNote: string, resumes: boolean,
 *   state: State, version: string, problem: string }} Status
 * @typedef {Pick<ReturnType<typeof import("./run.js").createRunner>, "run">} Runner
 */

export const DETECT_TIMEOUT_MS = 15_000;

/** A status before anything is known. @param {Agent} agent @returns {Status} */
export function unknown(agent) {
  const { id, name, vendor, command, install, guard, guardNote, resumes } = agent;
  return {
    id,
    name,
    vendor,
    command,
    install,
    guard,
    guardNote,
    resumes,
    state: "checking",
    version: "",
    problem: "",
  };
}

/**
 * Ask one program for its version.
 * @param {Runner} runner
 * @param {Agent} agent
 * @returns {Promise<Status>}
 */
export async function detectOne(runner, agent) {
  const base = unknown(agent);
  try {
    const outcome = await runner.run(agent.command, [...VERSION_ARGS], {
      timeoutMs: DETECT_TIMEOUT_MS,
    });
    if (outcome.timedOut)
      return {
        ...base,
        state: "broken",
        problem: `${agent.command} --version did not answer in ${DETECT_TIMEOUT_MS / 1000} s.`,
      };
    if (outcome.code !== 0) {
      const said = lastLine(outcome.stderr) || lastLine(outcome.stdout);
      return {
        ...base,
        state: "broken",
        problem: `${agent.command} --version failed${said ? `: ${said}` : ` with code ${outcome.code}`}.`,
      };
    }
    return { ...base, state: "ready", version: versionOf(outcome.stdout || outcome.stderr) };
  } catch (error) {
    if (error instanceof AgentError) {
      const state =
        error.kind === "missing"
          ? "missing"
          : error.kind === "denied"
            ? "denied"
            : error.kind === "unsupported"
              ? "unsupported"
              : "broken";
      return { ...base, state, problem: error.message };
    }
    return { ...base, state: "broken", problem: String(error) };
  }
}

/**
 * Every catalog program at once, in the catalog's order. `only` limits it to some ids.
 * @param {Runner} runner
 * @param {{ only?: string[], onStatus?(status: Status): void }} [options]
 * @returns {Promise<Status[]>}
 */
export async function detectAll(runner, options = {}) {
  const agents = options.only ? AGENTS.filter((a) => options.only?.includes(a.id)) : AGENTS;
  return Promise.all(
    agents.map(async (agent) => {
      const status = await detectOne(runner, agent);
      options.onStatus?.(status);
      return status;
    }),
  );
}

function lastLine(/** @type {string} */ text) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const last = lines.at(-1) ?? "";
  return last.length > 160 ? `${last.slice(0, 159)}…` : last;
}
