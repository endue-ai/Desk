// The desk commands a terminal's events run (`endue.terminal.event-commands`, issue 319), as
// Emacs's ring-bell-function is what the bell calls: the bell, a program's notification (OSC 9,
// 777, 99), a long command finishing (OSC 133 / 633) and a program ending each run the command the
// person named for that event, with what happened as its args, whether or not anyone looks and
// whatever the notification settings say. A flood is held back as notices are (flood.js). A
// command outside the plugin's cmd:invoke grant is asked for once (perm.request); a refusal or a
// failure is said once on the status line. Each run is a cmd.invoked event on the core's bus, so
// another plugin hears the terminal's events by subscribing to those (ADR 0250). No DOM.
import { createFlood } from "./flood.js";
import { codeOf } from "./spawn.js";

/**
 * @typedef {"bell" | "notification" | "command" | "exit"} Kind
 * @typedef {{
 *   commands: { run(id: string, args: Record<string, unknown>): Promise<unknown> },
 *   bridge: { call(method: string, params: object): Promise<any> },
 *   settings(): import("./shell.js").Settings, title(id: string): string,
 *   looking(id: string): boolean, now(): number, say(text: string): void,
 * }} Deps
 */

/** The events, as the setting names them. @type {readonly Kind[]} */
export const EVENTS = Object.freeze(["bell", "notification", "command", "exit"]);

/** When each event runs its command, as perm.request asks the person. */
const WHEN = {
  bell: "when a terminal rings the bell",
  notification: "when a program in a terminal sends a notification",
  command: "when a long command finishes in a terminal",
  exit: "when a terminal's program ends",
};
/** What the status line calls each event. */
const NOUN = {
  bell: "bell",
  notification: "notifications",
  command: "finished commands",
  exit: "exits",
};

/** @param {Deps} deps */
export function createHooks(deps) {
  const flood = createFlood(deps.now);
  /** Command id -> whether the person lets the plugin run it, asked once. */
  const asked = /** @type {Map<string, Promise<boolean>>} */ (new Map());
  const said = new Set();
  const sayOnce = (/** @type {string} */ text) => {
    if (said.has(text)) return;
    said.add(text);
    deps.say(text);
  };

  const ask = (/** @type {string} */ command, /** @type {Kind} */ kind) => {
    const known = asked.get(command);
    if (known) return known;
    const permission = { permission: "cmd:invoke", ids: [command] };
    const answer = deps.bridge
      .call("perm.request", { permission, reason: `To run ${command} ${WHEN[kind]}` })
      .then(
        (result) => result?.granted === true,
        () => false,
      );
    asked.set(command, answer);
    return answer;
  };

  const run = async (
    /** @type {string} */ command,
    /** @type {Kind} */ kind,
    /** @type {Record<string, unknown>} */ args,
  ) => {
    try {
      await deps.commands.run(command, args);
      return;
    } catch (error) {
      if (codeOf(error) !== "permission_denied") throw error;
    }
    if (!(await ask(command, kind))) throw Object.assign(new Error("refused"), { code: "refused" });
    await deps.commands.run(command, args);
  };

  return {
    /**
     * An event of the terminal `id`: the command the setting names for it runs, with `details`
     * over what every event says (the tab, whether the person looks, a level), unless a flood
     * holds it back; the next run says how many were.
     */
    fire(
      /** @type {string} */ id,
      /** @type {Kind} */ kind,
      /** @type {Record<string, unknown>} */ details = {},
    ) {
      const command = deps.settings().eventCommands[kind];
      if (!command) return;
      const more = flood.admit(id);
      if (more === null) return;
      const args = {
        ...{ event: kind, session: id, tab: deps.title(id), looking: deps.looking(id) },
        ...{ level: "info", ...details, ...(more > 0 ? { held: more } : {}) },
      };
      run(command, kind, args).catch((error) => {
        const code = codeOf(error);
        sayOnce(
          code === "refused"
            ? `Not allowed to run ${command} for the terminal's ${NOUN[kind]}.`
            : `Could not run ${command} for the terminal's ${NOUN[kind]}: ${code}.`,
        );
      });
    },
    forget: (/** @type {string} */ id) => flood.forget(id),
  };
}
