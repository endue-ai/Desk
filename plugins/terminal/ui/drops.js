// Drag and drop on the terminal (ADR 0119). Dropped paths are typed at the prompt as the session's
// shell reads them (sh, bash, zsh and fish; PowerShell; cmd), quoted where they need it and followed
// by a space, as Terminal.app and iTerm2 do; dropped text goes in as it is. Both go through the
// paste guard (paste.js), so a drop of several lines into a program that does not bracket pastes
// asks first, and nothing can end a bracketed paste early. A tab drags the folder its shell is in
// (OSC 7) as desk/paths, by reference only: nothing copies or moves the folder. A drop hands over
// paths, not access: the terminal reads nothing it is given, the shell does what the person types.

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginDnd} PluginDnd
 * @typedef {import("@endue-ai/plugin-sdk").DragOver} DragOver
 * @typedef {import("@endue-ai/plugin-sdk").DragStart} DragStart
 * @typedef {import("@endue-ai/plugin-sdk").DeskData} DeskData
 * @typedef {import("@endue-ai/plugin-sdk").Drop} Drop
 * @typedef {import("./types.js").Session} Session
 * @typedef {"posix" | "powershell" | "cmd"} Shell
 * @typedef {{
 *   dropTarget?: object,
 *   landing?(element: unknown): unknown,
 *   pasteGuard(id: string): { paste(text: string): Promise<boolean> } | undefined,
 * }} DropView
 * @typedef {{ shown(): string | null, sessions(): Session[], focus(id: string): void }} Terminals
 */

/** The JSON kind a tab drags as, so the tab strip can reorder it. */
export const TAB_KIND = "terminal/tab";
/** What a terminal takes: paths, and text (data of other kinds comes as its text). */
export const ACCEPTS = ["desk/paths", "desk/text", "text/plain"];

/** Characters that need no quoting: POSIX shells, PowerShell and cmd. */
const SAFE = {
  posix: /^[\w@%+=:,./-]+$/u,
  powershell: /^[\w./:\\-]+$/u,
  cmd: /^[\w./:\\-]+$/u,
};

/** The shell a program is, for quoting: PowerShell and cmd by name, every other one POSIX. */
export function shellOf(/** @type {string} */ command) {
  const name = command
    .slice(Math.max(command.lastIndexOf("/"), command.lastIndexOf("\\")) + 1)
    .toLowerCase()
    .replace(/\.exe$/u, "");
  if (name === "pwsh" || name === "powershell") return /** @type {Shell} */ ("powershell");
  return /** @type {Shell} */ (name === "cmd" ? "cmd" : "posix");
}

/** One word as `shell` reads it back unchanged. */
function quoteWord(/** @type {string} */ word, /** @type {Shell} */ shell) {
  if (word === "" || SAFE[shell].test(word)) return word;
  if (shell === "cmd") return `"${word}"`;
  if (shell === "powershell") return `'${word.replaceAll("'", "''")}'`;
  return `'${word.replaceAll("'", "'\\''")}'`;
}

/**
 * A path as the shell reads it: quoted when it must be. `~/` stays outside the quotes, so the shell
 * still expands it to the home folder (a quoted tilde is a file named `~`). cmd has no `~`.
 * @param {string} path
 * @param {Shell} [shell]
 */
export function shellQuote(path, shell = "posix") {
  if (shell !== "cmd" && (path === "~" || path.startsWith("~/")))
    return `${path.slice(0, 2)}${quoteWord(path.slice(2), shell)}`;
  return quoteWord(path, shell);
}

/** Dropped paths as typed at the prompt: each quoted, a space between and after them. */
export function pathsText(
  /** @type {Array<{ path: string }>} */ paths,
  /** @type {Shell} */ shell,
) {
  return `${paths.map((p) => shellQuote(p.path, shell)).join(" ")} `;
}

/**
 * What a tab drags: the folder its shell is in (when the shell said, OSC 7) as desk/paths, and the
 * tab itself for the strip to reorder. Only `link`: a drop refers to the folder, never moves it.
 * @param {Session} session
 * @returns {DragStart}
 */
export function tabDrag(session) {
  /** @type {DeskData} */
  const tab = { type: "desk/json", kind: TAB_KIND, value: { session: session.id } };
  const image = { label: session.title, ...(session.cwd ? { detail: session.cwd } : {}) };
  const items = /** @type {DeskData[]} */ (
    session.cwd
      ? [{ type: "desk/paths", paths: [{ path: session.cwd, kind: "folder" }] }, tab]
      : [tab, { type: "text/plain", text: session.title }]
  );
  return { items, effectAllowed: ["link"], image };
}

/**
 * Take drops on the terminal on screen.
 * @param {PluginDnd | undefined} dnd
 * @param {Terminals} terminals
 * @param {DropView} view
 */
export function createDrops(dnd, terminals, view) {
  /** The session on screen, while its program runs. */
  const running = () => {
    const id = terminals.shown();
    const session = terminals.sessions().find((s) => s.id === id);
    return session?.procId && session.program ? session : undefined;
  };

  /** Paths are referred to (link), text is copied in; nothing while no program runs. */
  const effect = (/** @type {DragOver} */ over) => {
    if (!running()) return "none";
    const allowed = over.effectAllowed;
    const order = over.types.includes("desk/paths") ? ["link", "copy"] : ["copy", "link"];
    return /** @type {"link" | "copy" | "none"} */ (
      order.find((e) => allowed.includes(/** @type {"link" | "copy"} */ (e))) ?? "none"
    );
  };

  const drop = async (/** @type {Drop} */ drop) => {
    const session = running();
    if (!session?.program) return "none";
    const text = drop.paths?.length
      ? pathsText(drop.paths, shellOf(session.program.command))
      : (drop.text ?? "");
    const guard = view.pasteGuard(session.id);
    if (!guard || !(await guard.paste(text))) return "none";
    terminals.focus(session.id);
    return undefined;
  };

  dnd?.onDrop(view.dropTarget ?? {}, drop, {
    accept: ACCEPTS,
    at: (element) => view.landing?.(element) ?? element,
    effect,
  });
}
