// The guard both Playwright configs call first (ADR 0018, ADR 0144). It runs inside Playwright, so it
// also stops runs that skip `just test-e2e`: `pnpm exec playwright test`, an IDE's test runner, a script.
//
// macOS: Playwright starts only under a live lease that scripts/e2e.mjs took (lease.mjs), with at most
// the runner's worker cap, and an agent never asks for a headed, UI or debug run, which opens Chromium
// windows. Elsewhere it only enforces the worker cap. Headless Chromium captures traces and screenshots
// through the DevTools protocol, not WindowServer, so they stay on everywhere.

import { leaseHeld, pidAlive } from "./lease.mjs";
import { checkDisplay, checkWorkers, WORKERS } from "./plan.mjs";

class GuardError extends Error {}

function refuse(reason) {
  return new GuardError(
    `${reason}\n\nRun the runtime tests with \`just test-e2e\` (headless Chromium, four workers at ` +
      "most). It is the one entry for Playwright in this repository (ADR 0018, ADR 0144).",
  );
}

/**
 * Check this Playwright process. Returns { workers } for the config, or throws.
 * `alive` checks the lease holder's pid (injected by tests).
 * @returns {{ workers: number | undefined }}
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
    return { workers: cap };
  }
  if (args.includes("--list")) return { workers: cap };

  if (!leaseHeld(env, alive)) {
    throw refuse("Playwright was started on macOS without a lease from the runner.");
  }
  const workers = Math.min(cap ?? WORKERS.test, WORKERS.test);
  checkWorkers(args, workers, GuardError);
  checkDisplay({ args, platform, env }, GuardError);
  return { workers };
}
