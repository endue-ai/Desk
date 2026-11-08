// Where and how a local Playwright run may happen (ADR 0018). Pure: the runner (scripts/e2e.mjs) and
// the Playwright configs' guard (guard.mjs) both decide from here.
//
// macOS: Playwright's WebKit is a real Cocoa app there. Dozens of them at once exhausted WindowServer's
// IOSurfaces; it aborted, macOS ended the login session and every agent lost its system services.
// So on macOS the tests run in a Linux container, and native WebKit is for a person at the keyboard.

/** Environment variables that AI coding agents set in the shells they run commands in. */
export const AGENT_MARKERS = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CODEX_SANDBOX",
  "CODEX_SANDBOX_NETWORK_DISABLED",
  "DESK_AGENT",
];

/** Workers per run: container runs share a Docker VM, native macOS runs share WindowServer. */
export const WORKERS = { container: 4, native: 2, perf: 1 };

const CONFIGS = { test: "playwright.config.ts", perf: "playwright.perf.config.ts" };
const DISPLAY_FLAGS = new Set(["--headed", "--ui", "--debug"]);

/** A run this machine must not start; the message says what to do instead. */
export class Refusal extends Error {}

/** True when an AI agent's tool started this process. */
export function isAgent(env) {
  return AGENT_MARKERS.some((key) => env[key] && env[key] !== "0");
}

/** The value of --workers / -j in Playwright arguments, or null. */
export function workerArg(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--workers" || arg === "-j") return args[i + 1] ?? "";
    if (arg.startsWith("--workers=")) return arg.slice("--workers=".length);
    if (/^-j\d/.test(arg)) return arg.slice(2);
  }
  return null;
}

/** Throws a Refusal when the arguments ask for more than `cap` workers (percentages included). */
export function checkWorkers(args, cap, Err = Refusal) {
  const asked = workerArg(args);
  if (asked === null) return;
  if (!/^\d+$/.test(asked) || Number(asked) > cap) {
    throw new Err(`This run allows at most ${cap} workers; got --workers ${asked} (ADR 0018).`);
  }
}

/**
 * Decide a run. `command` is "test" (Playwright arguments follow) or "perf" ("check" or "record").
 * Returns { where: "container" | "native", slots: 0 | 1 | "all", config, workers, args, env }.
 * `workers` is the cap handed to the guard as DESK_E2E_WORKERS (undefined: Playwright's default).
 */
export function planRun({ command, args = [], platform, env }) {
  if (!(command in CONFIGS)) throw new Refusal(`usage: e2e.mjs test [args] | perf [check|record]`);
  const config = CONFIGS[command];
  const perf = command === "perf";
  const mode = perf ? (args[0] ?? "check") : null;
  if (perf && !["check", "record"].includes(mode)) {
    throw new Refusal(`perf takes "check" or "record", not "${mode}".`);
  }
  const runEnv = mode === "record" ? { PERF_RECORD: "1" } : {};
  const runArgs = perf ? [] : args;

  if (env.CI)
    return { where: "native", slots: 0, config, workers: undefined, args: runArgs, env: runEnv };
  if (platform !== "darwin") {
    const slots = perf ? "all" : 1;
    return { where: "native", slots, config, workers: undefined, args: runArgs, env: runEnv };
  }

  const agent = isAgent(env);
  if (perf) {
    if (agent) {
      throw new Refusal(
        "just perf-opening measures frame times in native WebKit on this Mac. An AI agent never starts " +
          "native WebKit on macOS (ADR 0018); ask a person to run it.",
      );
    }
    return { where: "native", slots: "all", config, workers: WORKERS.perf, args: [], env: runEnv };
  }
  if (env.DESK_E2E_NATIVE === "1") {
    if (agent) {
      throw new Refusal(
        "DESK_E2E_NATIVE=1 is for a person at the keyboard. An AI agent never starts native WebKit on " +
          "macOS (ADR 0018): run `just test-e2e` without it, which uses the Linux container.",
      );
    }
    checkWorkers(args, WORKERS.native);
    return { where: "native", slots: 1, config, workers: WORKERS.native, args, env: runEnv };
  }
  const display = args.find((arg) => DISPLAY_FLAGS.has(arg));
  if (display) {
    throw new Refusal(
      `${display} needs a display, and the Linux container has none. A person can run ` +
        `\`DESK_E2E_NATIVE=1 just test-e2e ${display}\` to watch native WebKit (two workers).`,
    );
  }
  checkWorkers(args, WORKERS.container);
  return { where: "container", slots: 1, config, workers: WORKERS.container, args, env: runEnv };
}
