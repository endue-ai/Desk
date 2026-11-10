// How a local Playwright run may happen (ADR 0018, ADR 0144). Pure: the runner (scripts/e2e.mjs) and
// the Playwright configs' guard (guard.mjs) both decide from here.
//
// The runtime e2e runs on Playwright's headless Chromium on every OS (ADR 0144). Headless Chromium
// opens no window, so WindowServer, which dozens of native WebKit processes crashed on macOS (ADR 0018),
// never draws or captures one of them; the Linux container and the machine's two slots ended with it.
// What stays: `just test-e2e` is the only entry, a run has at most four workers (about 2 GB of
// Chromium, inside the old container's 3 GB; #48), and a headed, UI or debug run, which does open
// Chromium windows, is for a person at the keyboard.

/** Environment variables that AI coding agents set in the shells they run commands in. */
export const AGENT_MARKERS = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CODEX_SANDBOX",
  "CODEX_SANDBOX_NETWORK_DISABLED",
  "DESK_AGENT",
];

/** Workers per run: four keep a test run within its memory budget; perf measures with one. */
export const WORKERS = { test: 4, perf: 1 };

const CONFIGS = { test: "playwright.config.ts", perf: "playwright.perf.config.ts" };

/** Playwright flags that open Chromium windows instead of running headless. */
export const DISPLAY_FLAGS = new Set(["--headed", "--ui", "--debug"]);

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
    throw new Err(`This run allows at most ${cap} workers; got --workers ${asked} (ADR 0144).`);
  }
}

/** Throws when an agent on macOS asks for a run that opens Chromium windows. */
export function checkDisplay({ args, platform, env }, Err = Refusal) {
  if (platform !== "darwin" || !isAgent(env)) return;
  const display = args.find((arg) => DISPLAY_FLAGS.has(arg));
  if (display) {
    throw new Err(
      `${display} opens Chromium windows on this Mac's WindowServer, so it is for a person at the ` +
        "keyboard; an AI agent runs `just test-e2e` headless (ADR 0144).",
    );
  }
}

/**
 * Decide a run. `command` is "test" (Playwright arguments follow) or "perf" ("check" or "record").
 * Returns { config, workers, args, env }: `workers` is the cap handed to the guard as
 * DESK_E2E_WORKERS (undefined in CI: Playwright's default for the runner's cores).
 */
export function planRun({ command, args = [], platform, env }) {
  if (!(command in CONFIGS)) throw new Refusal(`usage: e2e.mjs test [args] | perf [check|record]`);
  const config = CONFIGS[command];
  if (command === "perf") {
    const mode = args[0] ?? "check";
    if (!["check", "record"].includes(mode)) {
      throw new Refusal(`perf takes "check" or "record", not "${mode}".`);
    }
    const runEnv = mode === "record" ? { PERF_RECORD: "1" } : {};
    return { config, workers: WORKERS.perf, args: [], env: runEnv };
  }
  if (env.CI) return { config, workers: undefined, args, env: {} };
  checkDisplay({ args, platform, env });
  checkWorkers(args, WORKERS.test);
  return { config, workers: WORKERS.test, args, env: {} };
}
