// The matrix's known failures (PG-101): a live file that fails on one major for a reason outside
// the plugin's tests, written down with that reason so the run stays green and the table says it.
// Each entry depends on what this machine has: backup-live runs the machine's pg_dump and
// pg_restore, whose major need not be the server's. Remove an entry when its follow-up lands.
import { spawnSync } from "node:child_process";

const BACKUP = "plugins/database/tests/backup-live.test.ts";

/** The major of a PostgreSQL program on the path (`pg_dump (PostgreSQL) 18.1`), 0 when none. */
export function toolMajor(program) {
  const done = spawnSync(program, ["--version"], { encoding: "utf8" });
  if (done.error || done.status !== 0) return 0;
  return Number(/\) (\d+)/u.exec(done.stdout)?.[1] ?? 0);
}

/** The known failures on server `major` with the machine's pg_dump major: file to reason. */
export function knownFailures(major, pgDump) {
  const known = {};
  if (pgDump && pgDump < major) {
    known[BACKUP] = `pg_dump ${pgDump} refuses a newer server; install pg_dump ${major} to run it`;
  }
  return known;
}

/** `states` with each failed file that `known` names marked "known". */
export function markKnown(states, known) {
  return Object.fromEntries(
    Object.entries(states).map(([file, state]) => [
      file,
      state === "failed" && known[file] ? "known" : state,
    ]),
  );
}
