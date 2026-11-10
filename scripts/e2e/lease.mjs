// A run's lease (ADR 0018, ADR 0144): scripts/e2e.mjs writes its pid and a fresh token into a file under
// ~/.cache/desk/e2e-runs and hands both to Playwright, whose guard checks them, so on macOS a Playwright
// that skipped `just test-e2e` stops before it starts a browser. It counts nothing: since the engine is
// Chromium any number of runs may hold one at once (the machine's two slots ended with ADR 0144).

import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Where the leases live; DESK_E2E_RUN_DIR overrides (tests, unusual homes). */
export function leaseRoot(env = process.env, home = homedir()) {
  return env.DESK_E2E_RUN_DIR || join(home, ".cache", "desk", "e2e-runs");
}

/** True while the process exists (EPERM: it exists, under another user). */
export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** The lease a file holds, or null. */
export function readLease(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Remove the leases of runs that ended without releasing them (killed, crashed). */
function sweep(root, alive) {
  for (const name of readdirSync(root)) {
    if (!name.endsWith(".json")) continue;
    const lease = readLease(join(root, name));
    if (!lease || !Number.isInteger(lease.pid) || !alive(lease.pid)) {
      rmSync(join(root, name), { force: true });
    }
  }
}

/**
 * Take a lease for this run. `owner` is recorded as is ({ pid, cwd, command }).
 * Returns { file, token, release() }; release removes the file.
 */
export function openLease({ root, owner, alive = pidAlive, now = Date.now }) {
  mkdirSync(root, { recursive: true });
  sweep(root, alive);
  const token = randomUUID();
  const file = join(root, `${owner.pid}-${token}.json`);
  const record = { ...owner, token, started: new Date(now()).toISOString() };
  writeFileSync(file, `${JSON.stringify(record)}\n`);
  return { file, token, release: () => rmSync(file, { force: true }) };
}

/** Whether `env` carries a live lease: the file DESK_E2E_RUN names, its token, its pid alive. */
export function leaseHeld(env, alive = pidAlive) {
  const lease = env.DESK_E2E_RUN ? readLease(env.DESK_E2E_RUN) : null;
  return Boolean(lease && lease.token === env.DESK_E2E_TOKEN && alive(lease.pid));
}
