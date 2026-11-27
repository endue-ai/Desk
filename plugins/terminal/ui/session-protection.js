// Terminal lifecycle protection, shared by direct actions and desk buffer closure.
import { shellMark } from "./osc.js";
import { isShell } from "./shell.js";

/** @typedef {import("./types.js").Session} Session */
/** @typedef {import("@endue-ai/plugin-sdk").PluginCommands} Commands */

const runningWork = (/** @type {Session} */ session) =>
  !!session.procId && !!session.program && (!isShell(session.program.command) || session.working);

/** @param {Commands} commands @param {() => void} changed */
export function createSessionProtection(commands, changed) {
  /** @type {WeakMap<Session, boolean>} */
  const sent = new WeakMap();
  /** @type {WeakSet<Session>} */
  const reviewing = new WeakSet();
  /** @type {WeakMap<Session, number>} */
  const generation = new WeakMap();

  const sync = (/** @type {Session} */ session, refresh = false) => {
    if (!session.buffer) return;
    const modified = runningWork(session);
    if (!refresh && (sent.get(session) ?? false) === modified) return;
    sent.set(session, modified);
    void commands.run("desk.buffers.update", { id: session.buffer, modified }).catch(() => {
      if (sent.get(session) === modified) sent.delete(session);
    });
  };

  const working = (/** @type {Session} */ session, /** @type {boolean} */ value) => {
    if (session.working === value) return;
    session.working = value;
    generation.set(session, (generation.get(session) ?? 0) + 1);
    sync(session);
    changed();
  };

  const input = (/** @type {Session} */ session, /** @type {import("./pipe.js").Input} */ data) => {
    if (/[\r\n]/u.test(typeof data === "string" ? data : data.binary)) working(session, true);
  };

  const osc = (
    /** @type {Session} */ session,
    /** @type {number} */ code,
    /** @type {string} */ data,
  ) => {
    if (code !== 133 && code !== 633) return;
    const mark = shellMark(data)?.mark;
    if (mark === "C") working(session, true);
    if (mark === "A" || mark === "D") working(session, false);
  };

  const reset = (/** @type {Session} */ session) => {
    session.working = false;
    sync(session);
  };

  /**
   * A command with force false must refuse a live operation. Direct controls and explicit
   * force ask once. The answer applies only to the process that was shown.
   * @param {Session} session
   * @param {"close" | "restart"} verb
   * @param {boolean | undefined} force
   * @param {() => boolean} present
   */
  const review = async (session, verb, force, present) => {
    if (force === false)
      throw new Error(
        `${session.title} has a running program. Set force: true to ask before ending it.`,
      );
    if (reviewing.has(session)) return false;
    const procId = session.procId;
    const work = generation.get(session);
    reviewing.add(session);
    try {
      const choice = await commands
        .run("desk.palette.pick", {
          title: `${session.title} has a running program. End it and ${verb}?`,
          items: [
            { id: "end", label: `End the program and ${verb}` },
            { id: "cancel", label: "Keep it running" },
          ],
        })
        .catch(() => undefined);
      return (
        choice === "end" &&
        present() &&
        session.procId === procId &&
        generation.get(session) === work
      );
    } finally {
      reviewing.delete(session);
    }
  };

  /**
   * @param {{
   *   sessions: Map<string, Session>, remove(id: string): unknown,
   *   signal(id: string, signal: "term"): Promise<boolean>, launch(session: Session): Promise<void>,
   *   line(id: string, text: string): void,
   * }} deps
   */
  const lifecycle = ({ sessions, remove, signal, launch, line }) => {
    const close = async (
      /** @type {string} */ id,
      /** @type {boolean | undefined} */ force = undefined,
    ) => {
      const session = sessions.get(id);
      if (
        !session ||
        (runningWork(session) &&
          !(await review(session, "close", force, () => sessions.get(id) === session)))
      )
        return;
      remove(id);
      if (session.buffer)
        void commands.run("desk.buffers.close", { id: session.buffer }).catch(() => {});
    };

    const restart = async (
      /** @type {string} */ id,
      /** @type {boolean | undefined} */ force = undefined,
    ) => {
      const session = sessions.get(id);
      if (!session) throw new Error(`No terminal ${id}.`);
      if (
        runningWork(session) &&
        !(await review(session, "restart", force, () => sessions.get(id) === session))
      )
        return;
      if (session.procId) {
        session.relaunch = true;
        if (!(await signal(id, "term"))) session.relaunch = false;
        return;
      }
      const again = `Starting ${session.title} again.`;
      line(id, session.exit ? `${session.exit} ${again}` : again);
      await launch(session);
    };
    return { close, restart };
  };

  return { sync, input, osc, reset, lifecycle };
}
