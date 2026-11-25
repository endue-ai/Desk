// A scripted PostgreSQL server that says the session's own settings (PG-12): `SHOW <name>` answers
// what the session signed in with (db.open's settings) for a session option's setting, the server's
// default otherwise, any other `SHOW` the wrapped server's own answer, and
// `select current_user` the role it took. The runtime e2e page wraps its servers in it.
import type { Script } from "./clients";

/** The session options' settings, with the server's defaults; any other `SHOW` goes to `script`. */
const DEFAULTS: Record<string, string> = {
  search_path: '"$user", public',
  role: "none",
  timezone: "UTC",
  lock_timeout: "0",
  idle_in_transaction_session_timeout: "0",
  application_name: "endue",
};

/** `script` with the session's settings read back. */
export function showServer(script: Script): Script {
  return (sql, who) => {
    const named = /^\s*show\s+([a-z_]+)\s*;?\s*$/iu.exec(sql)?.[1]?.toLowerCase();
    if (named && named in DEFAULTS) {
      const set = Object.entries(who).find(([key]) => key.toLowerCase() === named)?.[1];
      return { rows: [[named], [set ?? DEFAULTS[named] ?? ""]] };
    }
    if (/^\s*select\s+current_user\s*;?\s*$/iu.test(sql))
      return { rows: [["current_user"], [who.role ?? who.user ?? ""]] };
    return script(sql, who);
  };
}
