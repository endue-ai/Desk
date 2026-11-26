// Starting a terminal's program and signalling it, for sessions.js: the first of a session's
// programs that is there runs in a PTY of the session's size (spawn.js), a failure is written in the
// terminal and on its banner, and a signal goes to the program's process. No DOM.
import { programName } from "./names.js";
import { environment } from "./shell.js";
import { codeOf, scopeOf, spawnProgram } from "./spawn.js";

/**
 * @typedef {import("./types.js").Session} Session
 * @typedef {import("./types.js").View} View
 * @typedef {import("./shell.js").Settings} Settings
 */

/**
 * @param {{
 *   bridge: Pick<import("@endue-ai/plugin-sdk").PluginContext["bridge"], "call">, view: View,
 *   byProc: Map<string, string>, sessions: Map<string, Session>, settings(): Settings,
 *   held(id: string): Session,
 *   retitle(id: string, title: string): void, say(text: string): void, changed(): void,
 *   started(session: Session): void,
 * }} deps
 */
export function createLaunch(deps) {
  const { bridge, view, byProc, sessions, settings, retitle, say, changed, held } = deps;
  const ended = (/** @type {Session} */ session, /** @type {string | null} */ text) => {
    if (session.ended === text) return;
    session.ended = text;
    view.end(session.id, text);
  };

  /** Start the first of the session's programs that is there; a failure is written in the terminal. */
  const launch = async (
    /** @type {Session} */ session,
    /** @type {string | undefined} */ invocationId = undefined,
  ) => {
    for (const [index, program] of session.programs.entries()) {
      try {
        const size = { cols: session.cols, rows: session.rows };
        const { procId } = await spawnProgram(bridge, program, {
          env: environment(settings()),
          ...size,
          invocationId,
        });
        session.program = program;
        session.procId = procId;
        session.exit = null;
        ended(session, null);
        byProc.set(procId, session.id);
        retitle(session.id, programName(program, sessions.values(), session.id));
        deps.started(session);
        changed();
        return;
      } catch (error) {
        const code = codeOf(error);
        if (code === "not_found" && index < session.programs.length - 1) continue;
        const text =
          code === "permission_denied"
            ? `Not allowed to run ${program.command}.`
            : `Could not start ${program.command}: ${code}.`;
        session.exit = text;
        view.line(session.id, text);
        ended(session, text);
        say(text);
        changed();
        return;
      }
    }
  };

  /** Send `signal` to the session's program; false when none runs. */
  const signal = (
    /** @type {string} */ id,
    /** @type {"term" | "kill" | "int" | "hup"} */ signal,
  ) => {
    const session = held(id);
    if (!session.procId || !session.program) return Promise.resolve(false);
    const params = { procId: session.procId, signal, scope: scopeOf(session.program.command) };
    return bridge.call("proc.kill", params).then(
      () => true,
      (error) => {
        say(`Could not signal ${session.title}: ${codeOf(error)}.`);
        return false;
      },
    );
  };

  return { ended, launch, signal };
}
