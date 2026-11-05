/**
 * The agent programs on this computer as commands (ADR 0110), and so as Eris's tools (ADR 0088,
 * 0089): she lists the agents and their sessions, reads one, imports them, hands one agent a piece
 * of work, or several at once (dispatch), and reads how the work went. Work she hands over always
 * runs read-only; letting an agent change files stays the person's, on the agent's screen. The
 * commands are the runtime's own (`desk`), so they are there whatever plugins are on.
 */
import type {
  LocalAgentId,
  LocalAgentMessage,
  LocalAgentRun,
  LocalAgentSession,
} from "@endue-ai/bridge";
import type { LocalAgentsBridge, LocalAsk } from "../bridge/types";
import type { CommandCaller } from "../commands";
import { CommandError } from "../commands";
import type { ShellCtx } from "../shell/context";
import {
  askArgs,
  dispatchArgs,
  type Fields,
  importArgs,
  schemas,
  sessionsArgs,
  transcriptArgs,
} from "./local-agent-schemas";
import { applyRunStep, isLocalAgent, selectLocalAgent } from "./local-agents";

/** How long a tool waits for a run before it answers that the run goes on. */
export const WAIT_MS = 240_000;
/** How much of a text a tool's answer carries, so a turn stays small. */
const TOOL_TEXT = 2000;
const ENDED = new Set(["done", "failed", "stopped"]);

export interface LocalCommandOptions {
  /** How long ask and dispatch wait for a run (WAIT_MS). */
  waitMs?: number;
}

const cut = (text: string) => (text.length > TOOL_TEXT ? `${text.slice(0, TOOL_TEXT)}…` : text);

/** A run as a tool answers it: short, with what Eris needs to go on. */
function runAnswer(run: LocalAgentRun) {
  return {
    runId: run.runId,
    agent: run.agent,
    state: run.state,
    text: cut(run.text),
    tools: run.tools,
    ...(run.sessionId ? { sessionId: run.sessionId } : {}),
    ...(run.error ? { error: run.error } : {}),
  };
}

const sessionAnswer = (s: LocalAgentSession) => ({
  id: s.id,
  title: s.title,
  updatedAt: s.updatedAt,
  archived: s.archived,
  imported: s.imported,
  ...(s.cwd ? { cwd: s.cwd } : {}),
  ...(s.branch ? { branch: s.branch } : {}),
});

const messageAnswer = (m: LocalAgentMessage) => ({
  role: m.role,
  text: cut(m.text),
  ...(m.name ? { name: m.name } : {}),
});

/**
 * Ask, then wait for the run's end (or `waitMs`, after which it answers the run as it stands, still
 * running). Steps that arrive before the run's id is known wait for it.
 */
export function askAndWait(
  local: LocalAgentsBridge,
  ask: LocalAsk,
  waitMs: number,
): Promise<LocalAgentRun> {
  return new Promise((resolve, reject) => {
    let runs: LocalAgentRun[] = [];
    let id: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const early: Parameters<typeof applyRunStep>[1][] = [];
    const finish = () => {
      clearTimeout(timer);
      off();
      const run = runs[0];
      if (run) resolve(run);
      else reject(new CommandError("failed", "the run went missing"));
    };
    const step = (data: Parameters<typeof applyRunStep>[1]) => {
      if (data.runId !== id) return;
      runs = applyRunStep(runs, data);
      if (ENDED.has(data.kind)) finish();
    };
    const off = local.onEvent((event) => {
      if (event.kind !== "run") return;
      if (id === undefined) early.push(event.data);
      else step(event.data);
    });
    local.ask(ask).then(
      (run) => {
        id = run.runId;
        runs = [run];
        for (const data of early.splice(0)) step(data);
        if (runs[0]?.state === "running") timer = setTimeout(finish, waitMs);
        else finish();
      },
      (error: unknown) => {
        off();
        reject(error);
      },
    );
  });
}

export function defineLocalAgentCommands(
  ctx: ShellCtx,
  options: LocalCommandOptions = {},
): () => void {
  // A desk without local agents (a host with no core, the fixtures) offers none of these tools.
  if (!ctx.bridge.localAgents) return () => undefined;
  const { commands } = ctx.runtime;
  const waitMs = options.waitMs ?? WAIT_MS;
  const local = (): LocalAgentsBridge => {
    const bridge = ctx.bridge.localAgents;
    if (!bridge) throw new CommandError("failed", "this desk has no local agents");
    return bridge;
  };
  /** Mark the runs Eris hands out, so the agent's screen says who asked. */
  const mark = (from: CommandCaller, run: LocalAgentRun) => {
    ctx.store.set((s) => ({
      localRuns: applyRunStep(s.localRuns, {
        runId: run.runId,
        agent: run.agent,
        kind: "started",
        run,
      }),
      ...(from.caller === "agent:eris"
        ? { erisRuns: [run.runId, ...s.erisRuns].slice(0, 50) }
        : {}),
    }));
  };
  const work = async (from: CommandCaller, task: LocalAsk) => {
    const bridge = local();
    const watching: LocalAgentsBridge = {
      ...bridge,
      ask: async (ask) => {
        const started = await bridge.ask(ask);
        mark(from, started);
        return started;
      },
    };
    return runAnswer(await askAndWait(watching, { ...task, access: "read-only" }, waitMs));
  };

  const define = (
    id: string,
    title: string,
    keywords: string[],
    spec: { description: string; args: Fields; readOnly?: boolean },
    run: (args: unknown, from: CommandCaller) => unknown,
  ) =>
    commands.define(id, {
      title,
      keywords: ["agent", "local", "claude", "codex", "에이전트", ...keywords],
      owner: "desk",
      run,
      agent: {
        description: spec.description,
        args: spec.args,
        ...(spec.readOnly ? { readOnly: true } : {}),
      },
    });

  const offs = [
    commands.define("desk.agents.open", {
      title: "Local agents: open an agent's screen",
      keywords: ["agent", "local", "claude", "codex", "sessions", "에이전트", "세션"],
      owner: "desk",
      run: (args) => {
        const agent = (args as { agent?: unknown } | undefined)?.agent;
        const first = ctx.store.get().localAgents[0]?.id;
        const id = typeof agent === "string" && isLocalAgent(agent) ? agent : first;
        if (!id) throw new CommandError("failed", "no agent program was found on this computer");
        selectLocalAgent(ctx, id);
      },
    }),
    define(
      "desk.agents.list",
      "Local agents: list them",
      ["list", "found"],
      schemas.list,
      async () => ({
        agents: (await local().list()).map((a) => ({
          id: a.id,
          name: a.name,
          canRun: Boolean(a.program),
          sessions: a.sessions,
          archived: a.archived,
          imported: a.imported,
          running: a.running,
          ...(a.version ? { version: a.version } : {}),
        })),
      }),
    ),
    define(
      "desk.agents.sessions",
      "Local agents: list an agent's sessions",
      ["sessions", "history", "세션"],
      schemas.sessions,
      async (args) => {
        const { agent, from, query, limit } = sessionsArgs(args);
        const page = await local().sessions(agent, { from, limit, ...(query ? { query } : {}) });
        return { sessions: page.sessions.map(sessionAnswer), total: page.total };
      },
    ),
    define(
      "desk.agents.transcript",
      "Local agents: read a session",
      ["read", "transcript", "대화"],
      schemas.transcript,
      async (args) => {
        const { agent, sessionId, limit } = transcriptArgs(args);
        const read = await local().transcript(agent, sessionId, limit);
        return {
          session: sessionAnswer(read.session),
          messages: read.messages.map(messageAnswer),
          truncated: read.truncated,
        };
      },
    ),
    define(
      "desk.agents.import",
      "Local agents: import sessions into the desk",
      ["import", "archive", "가져오기"],
      schemas.import,
      async (args) => {
        const { agent, from } = importArgs(args);
        return local().import(agent, from);
      },
    ),
    define(
      "desk.agents.ask",
      "Local agents: hand an agent work",
      ["ask", "work", "task", "작업"],
      schemas.ask,
      (args, from) => work(from, askArgs(args)),
    ),
    define(
      "desk.agents.dispatch",
      "Local agents: hand several agents work at once",
      ["dispatch", "parallel", "orchestrate", "fan out"],
      schemas.dispatch,
      async (args, from) => ({
        results: await Promise.all(
          dispatchArgs(args).map((task) =>
            work(from, task).catch((error: unknown) => ({
              agent: task.agent,
              state: "failed" as const,
              error: error instanceof Error ? error.message : String(error),
            })),
          ),
        ),
      }),
    ),
    define(
      "desk.agents.runs",
      "Local agents: the work handed over",
      ["runs", "results", "status"],
      schemas.runs,
      async (args) => {
        const agent = (args as { agent?: unknown } | undefined)?.agent;
        const id: LocalAgentId | undefined =
          typeof agent === "string" && isLocalAgent(agent) ? agent : undefined;
        return { runs: (await local().runs(id)).slice(0, 20).map(runAnswer) };
      },
    ),
  ];
  return () => {
    for (const off of offs) off();
  };
}
