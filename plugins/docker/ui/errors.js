// What docker said, as a sentence the person reads: the daemon's and the CLI's prefixes taken off,
// usage hints dropped, and the failures everyone meets (Docker not running, the socket not allowed,
// Compose missing, a context that is gone) said the same way every time, with what to do.

/** @typedef {{ code: number | null, signal: string | null, stdout: string, stderr: string }} Outcome */

export const NOT_RUNNING =
  "Docker is not running: start Docker Desktop, Colima, OrbStack or the docker service, then refresh.";
export const SOCKET_DENIED =
  "Not allowed to reach the Docker socket: add your user to the docker group, or pick a rootless context.";
export const NO_COMPOSE =
  "Docker Compose v2 is not installed: the compose commands need the docker compose plugin.";

const PATTERNS = /** @type {const} */ ([
  [
    "daemon",
    /cannot connect to the docker daemon|failed to connect to the docker api|error during connect|is the docker daemon running/i,
  ],
  ["socket", /permission denied while trying to connect to the docker (daemon socket|api)/i],
  [
    "compose",
    /'compose' is not a docker command|unknown command:? "?(docker )?compose|unknown flag: --ansi/i,
  ],
  ["context", /context "[^"]*": context not found|context not found/i],
]);

/** Which of the well-known failures stderr shows, if any. */
export function kindOf(/** @type {string} */ stderr) {
  for (const [kind, pattern] of PATTERNS) if (pattern.test(stderr)) return kind;
  return undefined;
}

/** The context a "context not found" message names. */
const contextIn = (/** @type {string} */ stderr) => /context "([^"]*)"/.exec(stderr)?.[1] ?? "";

/**
 * What docker said, without its prefixes and hints, three lines at most; or a plain line about the
 * exit when it said nothing.
 * @param {string[]} args
 * @param {Outcome} outcome
 */
export function explain(args, outcome) {
  const kind = kindOf(outcome.stderr);
  if (kind === "daemon") return NOT_RUNNING;
  if (kind === "socket") return SOCKET_DENIED;
  if (kind === "compose") return NO_COMPOSE;
  if (kind === "context")
    return `The Docker context ${contextIn(outcome.stderr)} does not exist: pick another with Docker: switch context.`;
  const said = outcome.stderr
    .split("\n")
    .map(clean)
    .filter((line) => line !== "" && !HINT.test(line));
  if (said.length > 0) return sentence(said.slice(0, 3).join(" "));
  const what = args.find((arg) => !arg.startsWith("-")) ?? "";
  const how = outcome.signal ? `was ended by ${outcome.signal}` : `exited with ${outcome.code}`;
  return `docker ${what} ${how}.`;
}

/** Lines that are advice about the CLI, not about what failed. */
const HINT = /^(see '|run '|usage:|for more help|to get more help)/i;

/** One line without the daemon's and the CLI's prefixes. */
function clean(/** @type {string} */ line) {
  let text = stripAnsi(line).trim();
  for (;;) {
    const next = text.replace(/^(error response from daemon|error|fatal|warning|docker):\s*/i, "");
    if (next === text) return text;
    text = next;
  }
}

/** The first letter up and a full stop at the end, as the status line reads. */
function sentence(/** @type {string} */ text) {
  const up = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(up) ? up : `${up}.`;
}

// Built from char codes: control characters written into a regular expression read as noise.
const char = (/** @type {number} */ code) => String.fromCharCode(code);
const ESC = char(27);
const BEL = char(7);
/** CSI sequences (colours, cursor moves), OSC sequences (titles, links) and two-byte escapes. */
const ANSI = new RegExp(
  `${ESC}\\[[0-?]*[ -/]*[@-~]|${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|${ESC}[@-_]`,
  "g",
);
/** Control characters other than tab and newline. */
const CONTROL = new RegExp(`[${char(0)}-${char(8)}${char(11)}-${char(31)}${char(127)}]`, "g");

/** Text without ANSI escape sequences and other control characters. */
export function stripAnsi(/** @type {string} */ text) {
  return text.replace(ANSI, "").replace(CONTROL, "");
}
