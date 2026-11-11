// A terminal's name, which its tab and its desk buffer show: its program's, then whatever the
// program sets (OSC 0 and 2), unless the person named the tab. Tabs that start the same program are
// told apart by a number, zsh and zsh 2, as their buffers in the desk's list are (#160). No DOM.
import { basename } from "./shell.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginCommands} PluginCommands
 * @typedef {import("./spawn.js").Program} Program
 * @typedef {import("./types.js").Session} Session
 * @typedef {import("./types.js").View} View
 */

/**
 * The name a program gives a tab among `sessions`: its title or its command's, with the first
 * number from 2 up that keeps it apart from the other tabs' names.
 * @param {Program | undefined} program
 * @param {Iterable<Session>} sessions
 * @param {string} id The tab being named, whose own name does not count.
 */
export function programName(program, sessions, id) {
  const title = program ? (program.title ?? basename(program.command)) : "Terminal";
  const taken = new Set([...sessions].filter((s) => s.id !== id).map((s) => s.title));
  let name = title;
  for (let n = 2; taken.has(name); n += 1) name = `${title} ${n}`;
  return name;
}

/**
 * @param {{
 *   view: View, commands: Pick<PluginCommands, "run">, sessions: Map<string, Session>,
 *   held(id: string): Session, changed(): void,
 * }} deps
 */
export function createNames({ view, commands, sessions, held, changed }) {
  const name = (/** @type {Session} */ session, /** @type {string} */ title) => {
    if (title === "" || title === session.title) return;
    session.title = title;
    view.retitle(session.id, title);
    if (session.buffer) {
      commands.run("desk.buffers.update", { id: session.buffer, name: title }).catch(() => {});
    }
    changed();
  };
  return {
    /** The program set a title (OSC 0 or 2), or started; a name the person gave the tab wins. */
    retitle(/** @type {string} */ id, /** @type {string} */ title) {
      const session = held(id);
      if (!session.named) name(session, title);
    },
    /** The person names the tab; an empty name gives it back to the program. */
    rename(/** @type {string} */ id, /** @type {string} */ title) {
      const session = held(id);
      const given = title.trim();
      session.named = given !== "";
      const program = session.program ?? session.programs[0];
      name(session, given || programName(program, sessions.values(), id));
      changed();
    },
  };
}
