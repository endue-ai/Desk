// What programs say to the terminal in OSC sequences, read without the DOM (ADR 0113): the
// notifications of OSC 9 (iTerm2), 777 (rxvt's notify) and 99 (kitty), the working folder of OSC 7
// (and ConEmu's 9;9), and the shell-integration marks of OSC 133 (FinalTerm) and 633 (VS Code). The
// view registers a handler per code with xterm and hands the payload here.

/** @typedef {{ title: string, body: string, level: "info" | "warning", unfocused: boolean }} Note */
/** @typedef {{ mark: "A" | "B" | "C" | "D" | "E", exit?: number, command?: string }} Mark */

/** The OSC codes the terminal reads. */
export const CODES = Object.freeze([7, 9, 99, 133, 633, 777]);

/** CSI and OSC sequences and the two-character escapes, then any other control character. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal output is made of them
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[@-Z\\-_]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: the control characters are the point
const CONTROLS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;

/** Text a program sent, fit for a notification: no escapes, no control characters, one space. */
export function clean(/** @type {string} */ text) {
  return text.replace(ESCAPES, "").replace(CONTROLS, "").replace(/\s+/gu, " ").trim();
}

/** The most a notification's body says. */
export const BODY_MAX = 300;

/** `text` cut to `max` characters, the last one an ellipsis when it was longer. */
export function truncate(/** @type {string} */ text, max = BODY_MAX) {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}

/**
 * OSC 9: iTerm2's `9;message`. ConEmu numbers its own commands (`9;4;…` progress, `9;9;folder`
 * the working folder); those are not messages, and `9;2;text` is ConEmu's message box.
 * @returns {{ note: Note } | { cwd: string } | null}
 */
export function osc9(/** @type {string} */ data) {
  const numbered = /^(\d+)(?:;([\s\S]*))?$/u.exec(data);
  if (numbered) {
    const [, command, rest = ""] = numbered;
    if (command === "9") {
      const cwd = folder(rest.replace(/^"|"$/gu, ""));
      return cwd ? { cwd } : null;
    }
    if (command !== "2" || clean(rest) === "") return null;
    return { note: { title: "", body: clean(rest), level: "info", unfocused: false } };
  }
  const body = clean(data);
  return body ? { note: { title: "", body, level: "info", unfocused: false } } : null;
}

/** OSC 777: `notify;title;body` (other 777 commands are not notifications). */
export function osc777(/** @type {string} */ data) {
  const [command, title = "", ...rest] = data.split(";");
  if (command !== "notify") return null;
  const note = {
    title: clean(title),
    body: clean(rest.join(";")),
    level: "info",
    unfocused: false,
  };
  return note.title || note.body ? /** @type {Note} */ (note) : null;
}

/**
 * OSC 99, kitty's desktop notifications: `99;key=value:…;payload`, sent in chunks of one id until
 * `d=1` (the default). `p` says what the payload is (title or body; `?` asks what the terminal
 * can do, and close, icon and buttons are not shown), `e=1` that it is base64, `u=2` urgent, `o` when
 * to notify (`unfocused`, `invisible`: only when the person does not look).
 */
export function kitty() {
  /** @type {Map<string, { title: string, body: string, urgent: boolean, unfocused: boolean }>} */
  const pending = new Map();
  return {
    /** @returns {Note | null} */
    feed(/** @type {string} */ data) {
      const at = data.indexOf(";");
      const meta = at < 0 ? data : data.slice(0, at);
      const payload = at < 0 ? "" : data.slice(at + 1);
      /** @type {Record<string, string>} */
      const keys = Object.fromEntries(
        meta
          .split(":")
          .filter(Boolean)
          .map((pair) => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)]),
      );
      const id = keys.i ?? "";
      const kind = keys.p ?? "title";
      if (kind !== "title" && kind !== "body") {
        if (kind === "close") pending.delete(id);
        return null;
      }
      const text = keys.e === "1" ? fromBase64(payload) : payload;
      const note = pending.get(id) ?? { title: "", body: "", urgent: false, unfocused: false };
      note[kind] += text;
      if (keys.u === "2") note.urgent = true;
      if (keys.o === "unfocused" || keys.o === "invisible") note.unfocused = true;
      if (keys.d === "0") {
        pending.set(id, note);
        return null;
      }
      pending.delete(id);
      const title = clean(note.title);
      const body = clean(note.body);
      if (!title && !body) return null;
      const level = note.urgent ? "warning" : "info";
      return { title, body, level, unfocused: note.unfocused };
    },
  };
}

function fromBase64(/** @type {string} */ text) {
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(text), (c) => c.charCodeAt(0)));
  } catch {
    return "";
  }
}

/**
 * OSC 7, `file://host/path`: the folder the shell is in, as an absolute path with forward slashes
 * (`/C:/x` on Windows becomes `C:/x`), or null for anything else.
 */
export function osc7(/** @type {string} */ data) {
  const match = /^file:\/\/[^/]*(\/.*)$/u.exec(data.trim());
  if (!match?.[1]) return null;
  let path;
  try {
    path = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return folder(path.replace(/^\/([A-Za-z]:\/)/u, "$1"));
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: a folder holds none
const CONTROL = /[\x00-\x1f\x7f-\x9f]/u;

/** A folder fit to start a new terminal in: absolute, forward slashes, no control character. */
function folder(/** @type {string} */ path) {
  const p = path.replaceAll("\\", "/");
  return !CONTROL.test(p) && /^(\/|[A-Za-z]:\/)/u.test(p) ? p : null;
}

/**
 * OSC 133 and 633, the shell's marks: A prompt, B command typed, C command running, D;exit command
 * finished; 633;E;command line (escaped as VS Code escapes it: `\x3b` and `\\`).
 * @returns {Mark | null}
 */
export function shellMark(/** @type {string} */ data) {
  const [mark, ...rest] = data.split(";");
  if (mark === "A" || mark === "B" || mark === "C") return { mark };
  if (mark === "D") {
    const exit = Number.parseInt(rest[0] ?? "", 10);
    return Number.isInteger(exit) ? { mark, exit } : { mark };
  }
  if (mark === "E" && rest.length > 0) {
    const command = clean(
      (rest[0] ?? "").replace(/\\x([0-9a-fA-F]{2})|\\\\/gu, (_all, hex) =>
        hex ? String.fromCharCode(Number.parseInt(hex, 16)) : "\\",
      ),
    );
    return command ? { mark, command } : null;
  }
  return null;
}

/** The folder an OSC 7 or ConEmu 9;9 sequence names, or null. */
export function cwdOf(/** @type {number} */ code, /** @type {string} */ data) {
  if (code === 7) return osc7(data);
  const nine = code === 9 ? osc9(data) : null;
  return nine && "cwd" in nine ? nine.cwd : null;
}
