// The plugin's commands (endue.terminal.*, from the palette, keys, Eris and agents) and the desk's
// buffer requests, answered on the sessions. No DOM.
import { basename, isShell } from "./shell.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginCommands} PluginCommands
 * @typedef {ReturnType<typeof import("./sessions.js").createTerminals>} Terminals
 */

const strings = (/** @type {unknown} */ value) =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? /** @type {string[]} */ (value)
    : undefined;

/**
 * @param {PluginCommands} commands
 * @param {Terminals} app
 */
export function wireCommands(commands, app) {
  const sessionOf = (/** @type {unknown} */ args) => {
    const { session } = /** @type {{ session?: unknown }} */ (args ?? {});
    return typeof session === "string" && app.ids().includes(session) ? session : null;
  };
  /** The terminal a command is about: the one named, else the one on screen. */
  const current = (/** @type {unknown} */ args) => {
    const id = sessionOf(args) ?? app.shown();
    if (id === null) throw new Error("No terminal is open.");
    return id;
  };
  const step = (/** @type {number} */ by) => {
    const ids = app.ids();
    const shown = app.shown();
    if (ids.length === 0 || shown === null) throw new Error("No terminal is open.");
    const id = ids[(ids.indexOf(shown) + by + ids.length) % ids.length];
    if (id === undefined) return null;
    app.show(id);
    app.focus(id);
    return id;
  };

  commands.on("endue.terminal.new", async () => {
    const session = await app.open();
    app.focus(session.id);
    return session.id;
  });
  commands.on("endue.terminal.focus", async () => {
    const id = app.shown() ?? (await app.open()).id;
    app.focus(id);
    return id;
  });
  commands.on("endue.terminal.close", (args) => app.close(current(args)));
  commands.on("endue.terminal.next", () => step(1));
  commands.on("endue.terminal.previous", () => step(-1));
  commands.on("endue.terminal.clear", (args) => app.clear(current(args)));
  commands.on("endue.terminal.interrupt", (args) => app.signal(current(args), "int"));
  commands.on("endue.terminal.restart", (args) => app.restart(current(args)));

  // A program of its own, without a shell. A shell with arguments would run anything under the
  // shell's grant without the person hearing of it, so it is refused: run the program itself.
  commands.on("endue.terminal.run", async (args) => {
    const {
      command,
      args: rest,
      cwd,
      title,
    } = /** @type {{ command?: unknown, args?: unknown, cwd?: unknown, title?: unknown }} */ (
      args ?? {}
    );
    if (typeof command !== "string" || command === "" || /\s/u.test(command)) {
      throw new Error("Say which program to run: a name or a path, without arguments.");
    }
    const argv = strings(rest) ?? [];
    if (isShell(command) && argv.length > 0) {
      throw new Error(
        `${basename(command)} is a shell: run the program itself, so the person is asked about it.`,
      );
    }
    const session = await app.open({
      command,
      args: argv,
      cwd: typeof cwd === "string" && cwd !== "" ? cwd : app.settings().cwd,
      ...(typeof title === "string" && title !== "" ? { title } : {}),
    });
    if (!session.procId) throw new Error(session.exit ?? `Could not start ${command}.`);
    return { session: session.id, procId: session.procId };
  });

  // The desk's buffer list: a switch shows the terminal, a close (already decided) forgets it.
  const bufferOf = (/** @type {unknown} */ args) =>
    /** @type {{ buffer?: unknown } | undefined} */ (args)?.buffer;
  commands.on("desk.buffers.show", (args) => {
    const id = app.byBuffer(bufferOf(args));
    if (id === undefined) return;
    app.show(id);
    app.focus(id);
  });
  commands.on("desk.buffers.closed", (args) => {
    const id = app.byBuffer(bufferOf(args));
    if (id !== undefined) app.remove(id);
  });
}
