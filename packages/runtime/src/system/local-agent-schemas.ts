/**
 * What Eris reads of the desk.agents.* tools (ADR 0088): each one's description and args schema,
 * and the checks that turn a call's args into what the bridge takes. A call that does not match
 * fails with why, so the brain can call again.
 */
import type { LocalAgentId, LocalAgentSource } from "@endue-ai/bridge";
import type { LocalAsk } from "../bridge/types";
import { CommandError } from "../commands";
import { isLocalAgent } from "./local-ids";

export type Fields = Record<string, unknown>;

const AGENT = {
  type: "string",
  enum: ["claude", "codex"],
  description: "claude is Claude Code (Anthropic), codex is Codex (OpenAI).",
};
const SESSION = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" };
const ASK = {
  type: "object",
  properties: {
    agent: AGENT,
    prompt: { type: "string", minLength: 1, maxLength: 20000 },
    sessionId: { ...SESSION, description: "A session to continue, from desk.agents.sessions." },
    folder: {
      type: "string",
      pattern: "^(~|/)",
      description: "Where a new session works, a desk path such as ~/work/app; home when absent.",
    },
  },
  required: ["agent", "prompt"],
  additionalProperties: false,
};
const object = (properties: Fields, required: string[] = []) => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});

const READ_ONLY_RUN =
  "It runs read-only (Claude Code's plan mode, Codex's read-only sandbox): the agent reads, runs " +
  "commands that change nothing and answers. A run past 4 minutes keeps going: the answer then " +
  "says running with its runId, and desk.agents.runs tells how it ended.";

export const schemas = {
  list: {
    description:
      "List the agent programs on this computer the desk found (Claude Code, Codex): whether each " +
      "can be asked (canRun), its version, how many sessions it keeps, has archived and the desk " +
      "imported, and how many runs of it are going on.",
    args: object({}),
    readOnly: true,
  },
  sessions: {
    description:
      "List one local agent's sessions, the most recently active first, as its own files say: " +
      "from local (its sessions, the default), archive (the archived ones) or desk (the ones " +
      "imported into the desk). query keeps those whose title, folder or branch hold every word.",
    args: object(
      {
        agent: AGENT,
        from: { type: "string", enum: ["local", "archive", "desk"] },
        query: { type: "string", maxLength: 200 },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      ["agent"],
    ),
    readOnly: true,
  },
  transcript: {
    description:
      "Read one session of a local agent: its last turns (limit, 40 unless given), what the " +
      "person asked, what the agent answered and the tools it used.",
    args: object(
      { agent: AGENT, sessionId: SESSION, limit: { type: "integer", minimum: 1, maximum: 200 } },
      ["agent", "sessionId"],
    ),
    readOnly: true,
  },
  import: {
    description:
      "Import a local agent's sessions into the desk, so they stay readable here even when the " +
      "program drops its files: from local (its sessions, the default) or archive.",
    args: object({ agent: AGENT, from: { type: "string", enum: ["local", "archive"] } }, ["agent"]),
  },
  ask: {
    description: `Hand one local agent a piece of work and wait for its answer, in a new session or continuing sessionId. ${READ_ONLY_RUN}`,
    args: ASK,
    readOnly: true,
  },
  dispatch: {
    description: `Hand several pieces of work to local agents at once (up to 4: one agent several times, or Claude Code and Codex side by side) and wait for every answer. Use it to split a task into parts or to compare two agents. ${READ_ONLY_RUN}`,
    args: object({ tasks: { type: "array", items: ASK, minItems: 1, maxItems: 4 } }, ["tasks"]),
    readOnly: true,
  },
  runs: {
    description:
      "The work handed to local agents, the newest first: the agent, how it stands (running, " +
      "done, failed, stopped), its answer and the session it worked in.",
    args: object({ agent: AGENT }),
    readOnly: true,
  },
} satisfies Record<string, { description: string; args: Fields; readOnly?: boolean }>;

const bad = (why: string) => new CommandError("failed", why);

function fields(args: unknown): Record<string, unknown> {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return {};
  return args as Record<string, unknown>;
}

function agentOf(value: unknown): LocalAgentId {
  if (typeof value === "string" && isLocalAgent(value)) return value;
  throw bad("agent must be claude or codex");
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

function limitOf(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max)
    return value;
  throw bad(`limit must be a whole number from 1 to ${max}`);
}

function sessionOf(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && new RegExp(SESSION.pattern).test(value)) return value;
  throw bad("sessionId is not a session id");
}

export function sessionsArgs(args: unknown) {
  const a = fields(args);
  const from = a.from === undefined ? "local" : a.from;
  if (from !== "local" && from !== "archive" && from !== "desk")
    throw bad("from must be local, archive or desk");
  return {
    agent: agentOf(a.agent),
    from: from as LocalAgentSource,
    query: text(a.query),
    limit: limitOf(a.limit, 20, 50),
  };
}

export function transcriptArgs(args: unknown) {
  const a = fields(args);
  const sessionId = sessionOf(a.sessionId);
  if (!sessionId) throw bad("sessionId is required");
  return { agent: agentOf(a.agent), sessionId, limit: limitOf(a.limit, 40, 200) };
}

export function importArgs(args: unknown) {
  const a = fields(args);
  const from = a.from === undefined ? "local" : a.from;
  if (from !== "local" && from !== "archive") throw bad("from must be local or archive");
  return { agent: agentOf(a.agent), from: from as "local" | "archive" };
}

/** One piece of work: always read-only, whatever the call says. */
export function askArgs(args: unknown): LocalAsk {
  const a = fields(args);
  const prompt = text(a.prompt);
  if (!prompt) throw bad("prompt must say what to do");
  if (prompt.length > 20000) throw bad("prompt is longer than 20000 characters");
  const sessionId = sessionOf(a.sessionId);
  const folder = text(a.folder);
  if (folder && !/^(~|\/)/.test(folder)) throw bad("folder must start with ~ or /");
  return {
    agent: agentOf(a.agent),
    prompt,
    access: "read-only",
    ...(sessionId ? { sessionId } : {}),
    ...(folder && !sessionId ? { cwd: folder } : {}),
  };
}

export function dispatchArgs(args: unknown): LocalAsk[] {
  const tasks = fields(args).tasks;
  if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > 4)
    throw bad("tasks must hold one to four pieces of work");
  return tasks.map(askArgs);
}
