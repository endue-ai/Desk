// What agents read of the terminals and how they type into one (ADR 0088): the sessions, the text a
// session's program printed last (its kept tail, escape sequences taken out), and text typed into
// its program. Typing runs whatever the shell makes of it, so the manifest marks endue.terminal.send
// irreversible: an agent's call waits for the person's approval with the text shown (ADR 0078). No DOM.
import { decode } from "./output.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginCommands} PluginCommands
 * @typedef {ReturnType<typeof import("./sessions.js").createTerminals>} Terminals
 * @typedef {import("./output.js").Chunk} Chunk
 * @typedef {{ isWrapped: boolean, translateToString(trimRight?: boolean): string }} ScrollbackLine
 * @typedef {{ length: number, getLine(index: number): ScrollbackLine | undefined }} Scrollback
 */

/** How much text endue.terminal.output answers unless asked for less. */
export const OUTPUT_CHARS = 4000;
/** The most one send types. */
const SEND_MAX = 4096;
const MATCH_LIMIT = 100;
const QUERY_LIMIT = 200;
const LINE_LIMIT = 512;

/** CSI and OSC sequences, and the other two-character escapes. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal output is made of them
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

/** A session's kept output as plain text: escapes out, each line as its last carriage return left it. */
export function plainText(/** @type {Chunk[]} */ chunks) {
  const decoder = new TextDecoder();
  const text = chunks
    .map((chunk) => {
      const piece = decode(chunk);
      return typeof piece === "string" ? piece : decoder.decode(piece, { stream: true });
    })
    .join("");
  return text
    .replace(ESCAPES, "")
    .split("\n")
    .map((line) => line.replace(/\r$/, "").split("\r").at(-1) ?? "")
    .join("\n");
}

/** Join cells that wrap onto another row while keeping the first row number. @param {Scrollback} buffer */
export function* scrollbackLines(buffer) {
  let first = 0;
  let text = "";
  for (let at = 0; at < buffer.length; at++) {
    const line = buffer.getLine(at);
    const next = buffer.getLine(at + 1);
    text += line?.translateToString(!next?.isWrapped) ?? "";
    if (next?.isWrapped) continue;
    yield { line: first + 1, text };
    first = at + 1;
    text = "";
  }
}

/**
 * @param {PluginCommands} commands
 * @param {Terminals} app
 * @param {() => unknown} showFind
 * @param {(id: string) => Scrollback | undefined} scrollback
 */
export function wireAgent(commands, app, showFind, scrollback) {
  /** The session named, else the one on screen. */
  const sessionOf = (/** @type {unknown} */ args) => {
    const { session } = /** @type {{ session?: unknown }} */ (args ?? {});
    const id = typeof session === "string" ? session : app.shown();
    const found = app.sessions().find((s) => s.id === id);
    if (!found) throw new Error(id === null ? "No terminal is open." : `No terminal ${id}.`);
    return found;
  };

  commands.on("endue.terminal.sessions", () =>
    app.sessions().map((s) => ({
      session: s.id,
      title: s.title,
      ...(s.program ? { command: s.program.command, args: s.program.args } : {}),
      cwd: s.cwd ?? s.program?.cwd ?? null,
      running: s.procId !== null,
      ...(s.exit ? { exit: s.exit } : {}),
      shown: s.id === app.shown(),
    })),
  );

  commands.on("endue.terminal.find", (args, invocation) => {
    const { text } = /** @type {{ text?: unknown }} */ (args ?? {});
    if (text === undefined && !invocation?.caller.startsWith("agent:")) return showFind();
    if (
      typeof text !== "string" ||
      !text.trim() ||
      text.length > QUERY_LIMIT ||
      /[\r\n]/u.test(text)
    )
      throw new Error(`Give search text on one line, at most ${QUERY_LIMIT} characters.`);
    const session = sessionOf(args);
    const buffer = scrollback(session.id);
    const lines = buffer
      ? scrollbackLines(buffer)
      : plainText(session.chunks)
          .split("\n")
          .map((line, at) => ({ line: at + 1, text: line }));
    const needle = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu");
    const matches = [];
    for (const row of lines) {
      const match = needle.exec(row.text);
      if (!match) continue;
      if (matches.length === MATCH_LIMIT) return { session: session.id, matches, truncated: true };
      const left = Math.max(0, match.index - Math.floor((LINE_LIMIT - text.length) / 2));
      matches.push({
        line: row.line,
        column: match.index + 1,
        text: row.text.slice(left, left + LINE_LIMIT),
      });
    }
    return { session: session.id, matches, truncated: false };
  });

  commands.on("endue.terminal.output", (args) => {
    const session = sessionOf(args);
    const { chars } = /** @type {{ chars?: unknown }} */ (args ?? {});
    const limit = typeof chars === "number" && chars > 0 ? Math.floor(chars) : OUTPUT_CHARS;
    const text = plainText(session.chunks);
    return {
      session: session.id,
      text: text.slice(-limit),
      truncated: text.length > limit,
      running: session.procId !== null,
    };
  });

  commands.on("endue.terminal.send", (args) => {
    const session = sessionOf(args);
    const { text, enter } = /** @type {{ text?: unknown, enter?: unknown }} */ (args ?? {});
    if (typeof text !== "string" || text.length > SEND_MAX)
      throw new Error(`Say what to type: text, ${SEND_MAX} characters at most.`);
    if (session.procId === null) throw new Error(`${session.title} has no program running.`);
    app.input(session.id, enter === false ? text : `${text}\r`);
    return { session: session.id };
  });
}
