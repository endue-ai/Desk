// The default shell and how it starts, per platform, and the terminal's settings with their
// defaults and limits. No DOM and no SDK, so the tests run it in Node.

/** @typedef {"mac" | "linux" | "windows"} Platform */
/** @typedef {{ command: string, args: string[] }} Program */
/**
 * @typedef {{
 *   shell: string, args: string[], login: "auto" | "yes" | "no", cwd: string,
 *   env: Record<string, string>, scrollback: number, fontFamily: string, fontSize: number,
 *   cursorStyle: "block" | "underline" | "bar", cursorBlink: boolean, bell: "notify" | "none",
 *   copyOnSelect: boolean, keysToDesk: string[],
 * }} Settings
 */

/** The shells the manifest declares, so a built-in terminal runs them without asking. */
export const SHELLS = ["zsh", "bash", "fish", "sh", "pwsh", "powershell", "cmd"];

/** Setting keys start with this, as init.yaml and `contributes.settings` write them. */
export const PREFIX = "endue.terminal.";

/** @type {Readonly<Settings>} */
export const DEFAULTS = Object.freeze({
  shell: "",
  args: [],
  login: "auto",
  cwd: "~",
  env: {},
  scrollback: 10000,
  fontFamily: "",
  fontSize: 13,
  cursorStyle: "block",
  cursorBlink: true,
  bell: "notify",
  copyOnSelect: false,
  keysToDesk: [],
});

/** @returns {Platform} */
export function platformOf(/** @type {string | undefined} */ navigatorPlatform) {
  const platform = (navigatorPlatform ?? "").toLowerCase();
  if (platform.startsWith("mac") || platform.includes("iphone") || platform.includes("ipad")) {
    return "mac";
  }
  return platform.startsWith("win") ? "windows" : "linux";
}

/** The last segment of a path, with Windows's `.exe` taken off. */
export function basename(/** @type {string} */ path) {
  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  return name.replace(/\.exe$/iu, "");
}

/**
 * The programs to try, in order, until one starts: the shell the settings name, or the platform's
 * usual shells. macOS terminals start login shells; a `-l` goes along there unless told otherwise.
 * @param {Platform} platform
 * @param {Settings} settings
 * @returns {Program[]}
 */
export function candidates(platform, settings) {
  const shells = settings.shell
    ? [settings.shell]
    : platform === "windows"
      ? ["pwsh", "powershell", "cmd"]
      : platform === "mac"
        ? ["zsh", "bash", "sh"]
        : ["bash", "zsh", "sh"];
  return shells.map((command) => ({ command, args: argsFor(command, platform, settings) }));
}

/**
 * @param {string} command
 * @param {Platform} platform
 * @param {Settings} settings
 */
function argsFor(command, platform, settings) {
  const name = basename(command).toLowerCase();
  const login = settings.login === "yes" || (settings.login === "auto" && platform === "mac");
  const own =
    login && ["zsh", "bash", "fish", "sh"].includes(name)
      ? ["-l"]
      : name === "pwsh" || name === "powershell"
        ? ["-NoLogo"]
        : [];
  return [...own, ...settings.args];
}

/** The environment every terminal gets on top of the person's own. */
export function environment(/** @type {Settings} */ settings) {
  return {
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    TERM_PROGRAM: "endue-desk",
    ...settings.env,
  };
}

/** Whether `command` is one of the shells: a program that runs whatever its arguments say. */
export function isShell(/** @type {string} */ command) {
  return SHELLS.includes(basename(command).toLowerCase());
}

const strings = (/** @type {unknown} */ value) =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? /** @type {string[]} */ (value)
    : undefined;

/**
 * The settings init.get hands over (`endue.terminal.*`), each checked against its kind and range,
 * with the default for whatever is missing or wrong.
 * @param {Record<string, unknown>} raw
 * @returns {Settings}
 */
export function parseSettings(raw) {
  const get = (/** @type {string} */ key) => raw[`${PREFIX}${key}`];
  const string = (/** @type {string} */ key, /** @type {string} */ fallback) => {
    const value = get(key);
    return typeof value === "string" ? value : fallback;
  };
  const integer = (
    /** @type {string} */ key,
    /** @type {number} */ fallback,
    /** @type {number} */ min,
    /** @type {number} */ max,
  ) => {
    const value = get(key);
    return Number.isInteger(value) && Number(value) >= min && Number(value) <= max
      ? Number(value)
      : fallback;
  };
  const boolean = (/** @type {string} */ key, /** @type {boolean} */ fallback) => {
    const value = get(key);
    return typeof value === "boolean" ? value : fallback;
  };
  /**
   * @template {string} T
   * @param {string} key
   * @param {readonly T[]} choices
   * @param {T} fallback
   */
  const choice = (key, choices, fallback) => {
    const value = get(key);
    return choices.includes(/** @type {T} */ (value)) ? /** @type {T} */ (value) : fallback;
  };
  const env = get("env");
  const environment =
    env && typeof env === "object" && !Array.isArray(env)
      ? Object.fromEntries(
          Object.entries(env).filter(
            ([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) && typeof value === "string",
          ),
        )
      : DEFAULTS.env;
  return {
    shell: string("shell", DEFAULTS.shell).trim(),
    args: strings(get("args")) ?? DEFAULTS.args,
    login: choice("login", /** @type {const} */ (["auto", "yes", "no"]), DEFAULTS.login),
    cwd: string("cwd", DEFAULTS.cwd).trim() || DEFAULTS.cwd,
    env: /** @type {Record<string, string>} */ (environment),
    scrollback: integer("scrollback", DEFAULTS.scrollback, 0, 100000),
    fontFamily: string("font-family", DEFAULTS.fontFamily).trim(),
    fontSize: integer("font-size", DEFAULTS.fontSize, 8, 40),
    cursorStyle: choice(
      "cursor-style",
      /** @type {const} */ (["block", "underline", "bar"]),
      DEFAULTS.cursorStyle,
    ),
    cursorBlink: boolean("cursor-blink", DEFAULTS.cursorBlink),
    bell: choice("bell", /** @type {const} */ (["notify", "none"]), DEFAULTS.bell),
    copyOnSelect: boolean("copy-on-select", DEFAULTS.copyOnSelect),
    keysToDesk: strings(get("keys-to-desk")) ?? DEFAULTS.keysToDesk,
  };
}
