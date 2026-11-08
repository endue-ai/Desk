// The palette's Terminals group (contributes.paletteProviders, specs/plugin/v0): the open tabs whose
// title, program or folder holds every typed word, in tab order. A pick runs endue.terminal.focus
// with the session, which shows and focuses it as Control+` does. No DOM.
import { basename } from "./shell.js";

/** @typedef {ReturnType<typeof import("./sessions.js").createTerminals>} Terminals */

/** How many results the palette gets when it does not say, and the most it may ask for. */
const LIMIT = 8;
const MOST = 50;

/**
 * endue.terminal.tabs: a PaletteQuery answered with the open terminals; none without words.
 * @param {unknown} args
 * @param {Pick<Terminals, "sessions" | "shown">} app
 */
export function findTerminals(args, app) {
  const { query, limit } = /** @type {{ query?: unknown, limit?: unknown }} */ (args ?? {});
  const words = typeof query === "string" ? query.toLowerCase().split(/\s+/).filter(Boolean) : [];
  if (words.length === 0) return { results: [] };
  const n = typeof limit === "number" && Number.isInteger(limit) ? limit : LIMIT;
  const shown = app.shown();
  const results = app
    .sessions()
    .map((session) => {
      const program = session.program ?? session.programs[0];
      return {
        session,
        name: program ? basename(program.command) : "",
        folder: session.cwd ?? program?.cwd ?? "",
      };
    })
    .filter(({ session, name, folder }) => {
      const text = `${session.title} ${name} ${folder} terminal`.toLowerCase();
      return words.every((word) => text.includes(word));
    })
    .slice(0, Math.min(Math.max(n, 1), MOST))
    .map(({ session, name, folder }) => {
      const state = session.procId === null ? "ended" : session.id === shown ? "on screen" : "";
      return {
        id: session.id,
        title: session.title || name || session.id,
        detail: [name, folder, state].filter(Boolean).join(" · "),
        kind: "terminal",
        actions: [
          {
            command: "endue.terminal.focus",
            title: "Focus the terminal",
            args: { session: session.id },
          },
        ],
      };
    });
  return { results };
}
