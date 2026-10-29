// Machine-wide e2e slots (ADR 0018): every worktree on this machine shares them, so parallel agents
// never run more than DESK_E2E_SLOTS (default 2) Playwright runs at once. A slot is a directory under
// ~/.cache/desk/e2e-slots; mkdir is atomic, so taking one needs no daemon. owner.json names the holder.
// A slot whose holder died (killed, crashed, machine slept through a timeout) is taken over, and the
// container it recorded is removed.

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const EXCLUSIVE = "exclusive";
/** A slot directory without owner.json is still being created, unless it is older than this. */
const CREATING_MS = 30_000;

/** Where the slots live; DESK_E2E_SLOT_DIR overrides (tests, unusual homes). */
export function slotRoot(env = process.env, home = homedir()) {
  return env.DESK_E2E_SLOT_DIR || join(home, ".cache", "desk", "e2e-slots");
}

/** How many runs may share the machine: DESK_E2E_SLOTS, default 2, at least 1. */
export function slotCount(env = process.env) {
  const count = Number(env.DESK_E2E_SLOTS ?? 2);
  return Number.isInteger(count) && count >= 1 ? count : 2;
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

/** The holder recorded in a slot directory, or null. */
export function readOwner(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, "owner.json"), "utf8"));
  } catch {
    return null;
  }
}

function stale(dir, owner, alive, now) {
  if (owner) return !Number.isInteger(owner.pid) || !alive(owner.pid);
  try {
    return now() - statSync(dir).mtimeMs > CREATING_MS;
  } catch {
    return false;
  }
}

/** Remove a stale slot under a small mutex, so two takers never remove each other's fresh slot. */
function clearStale(dir, alive, onStale, now) {
  const mutex = `${dir}.takeover`;
  try {
    mkdirSync(mutex);
  } catch {
    if (stale(mutex, null, alive, now)) rmSync(mutex, { recursive: true, force: true });
    return;
  }
  try {
    const owner = readOwner(dir);
    if (!stale(dir, owner, alive, now)) return;
    if (owner) onStale?.(owner);
    const grave = `${dir}.gone-${randomUUID()}`;
    renameSync(dir, grave);
    rmSync(grave, { recursive: true, force: true });
  } catch {
    // Someone else cleared it first; the next attempt sees the new state.
  } finally {
    rmSync(mutex, { recursive: true, force: true });
  }
}

/** Try to take one named slot directory. True when it is ours now. */
function take(root, name, record, opts) {
  const dir = join(root, name);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(dir);
      writeFileSync(join(dir, "owner.json"), `${JSON.stringify(record)}\n`);
      return true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      clearStale(dir, opts.alive, opts.onStale, opts.now);
    }
  }
  return false;
}

function liveOwner(root, name, opts) {
  const dir = join(root, name);
  const owner = readOwner(dir);
  return owner && !stale(dir, owner, opts.alive, opts.now) ? owner : null;
}

/**
 * Wait for a slot (or every slot, when `exclusive`) and hold it until release().
 * An exclusive run first takes the "exclusive" mark, so runs that arrive while it waits queue behind it.
 * Returns { token, dirs, release(), update(fields) }.
 */
export async function acquire({
  root,
  count,
  exclusive = false,
  owner,
  alive = pidAlive,
  onStale,
  onWait,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  timeoutMs = 45 * 60_000,
}) {
  mkdirSync(root, { recursive: true });
  const token = randomUUID();
  const record = { ...owner, token, exclusive, started: new Date(now()).toISOString() };
  const opts = { alive, onStale, now };
  const names = Array.from({ length: count }, (_, i) => `slot-${i}`);
  const held = new Set();
  const mine = (name) => readOwner(join(root, name))?.token === token;
  const lease = {
    token,
    dirs: [],
    update(fields) {
      Object.assign(record, fields);
      for (const name of held)
        writeFileSync(join(root, name, "owner.json"), JSON.stringify(record));
    },
    release() {
      for (const name of [...held, EXCLUSIVE]) {
        if (mine(name)) rmSync(join(root, name), { recursive: true, force: true });
      }
      held.clear();
    },
  };

  const granted = () => {
    lease.dirs = names.filter((name) => held.has(name)).map((name) => join(root, name));
    return lease;
  };
  const started = now();
  for (;;) {
    if (exclusive) {
      if (held.has(EXCLUSIVE) || take(root, EXCLUSIVE, record, opts)) {
        held.add(EXCLUSIVE);
        for (const name of names)
          if (!held.has(name) && take(root, name, record, opts)) held.add(name);
        if (names.every((name) => held.has(name))) return granted();
      }
    } else if (!liveOwner(root, EXCLUSIVE, opts)) {
      const free = names.find((name) => take(root, name, record, opts));
      if (free) {
        held.add(free);
        return granted();
      }
    }
    if (now() - started > timeoutMs) {
      lease.release();
      throw new Error(`no e2e slot came free in ${Math.round(timeoutMs / 1000)} s (${root})`);
    }
    onWait?.(names.map((name) => liveOwner(root, name, opts)).filter(Boolean));
    await sleep(2_000);
  }
}
