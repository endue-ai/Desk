// The guard both Playwright configs call first (ADR 0018). It runs inside Playwright, so it also
// stops runs that skip `just test-e2e`: `pnpm exec playwright test`, an IDE's test runner, a script.
//
// macOS: Playwright starts only with a live slot that scripts/e2e.mjs took for a person
// (DESK_E2E_NATIVE=1 or perf), with at most the runner's worker cap and no traces, screenshots or
// video, which capture windows through WindowServer. Elsewhere it only enforces the worker cap.

import { checkWorkers, isAgent } from "./plan.mjs";
import { pidAlive, readOwner } from "./slots.mjs";

/** @type {{ trace: "off", screenshot: "off", video: "off" }} */
const NATIVE_USE = { trace: "off", screenshot: "off", video: "off" };

class GuardError extends Error {}

function refuse(reason) {
  return new GuardError(
    `${reason}\n\nRun the runtime tests with \`just test-e2e\` (on macOS: in a Linux container, two runs ` +
      "per machine at most). Native WebKit on macOS crashed WindowServer and ended the login session " +
      "for every agent on this Mac (ADR 0018).",
  );
}

function traceArg(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--trace") return args[i + 1] ?? "";
    if (args[i].startsWith("--trace=")) return args[i].slice("--trace=".length);
  }
  return null;
}

/**
 * Check this Playwright process. Returns { workers, use } for the config, or throws.
 * `alive` checks the slot holder's pid (injected by tests).
 * @returns {{ workers: number | undefined, use: { trace?: "off", screenshot?: "off", video?: "off" } }}
 */
export function e2eGuard({
  platform = process.platform,
  env = process.env,
  argv = process.argv,
  alive = pidAlive,
} = {}) {
  const args = argv.slice(2);
  const cap = env.DESK_E2E_WORKERS ? Number(env.DESK_E2E_WORKERS) : undefined;
  if (platform !== "darwin") {
    if (cap !== undefined) checkWorkers(args, cap, GuardError);
    return { workers: cap, use: {} };
  }
  if (args.includes("--list")) return { workers: cap, use: {} };

  if (isAgent(env)) throw refuse("An AI agent started Playwright natively on macOS.");
  const slot = env.DESK_E2E_SLOT;
  const owner = slot ? readOwner(slot) : null;
  const held = owner && owner.token === env.DESK_E2E_TOKEN && alive(owner.pid);
  if (!held) throw refuse("Playwright was started on macOS without an e2e slot from the runner.");

  const workers = Math.min(cap ?? 2, 2);
  checkWorkers(args, workers, GuardError);
  const trace = traceArg(args);
  if (trace !== null && trace !== "off") {
    throw refuse(
      `--trace ${trace} captures windows through WindowServer; native macOS runs keep it off.`,
    );
  }
  return { workers, use: { ...NATIVE_USE } };
}
