// A scripted PostgreSQL server that says the session's own settings (PG-12): `SHOW <name>` answers
// what the session signed in with (db.open's settings), the server's default otherwise, and
// `select current_user` the role it took. The runtime e2e page wraps its servers in it.
import type { Script } from "./clients";

const DEFAULTS: Record<string, string> = { search_path: '"$user", public', timezone: "UTC" };

/** `script` with the session's settings read back. */
export function showServer(script: Script): Script {
  return (sql, who) => {
    const named = /^\s*show\s+([a-z_]+)\s*;?\s*$/iu.exec(sql)?.[1]?.toLowerCase();
    if (named) {
      const set = Object.entries(who).find(([key]) => key.toLowerCase() === named)?.[1];
      return { rows: [[named], [set ?? DEFAULTS[named] ?? ""]] };
    }
    if (/^\s*select\s+current_user\s*;?\s*$/iu.test(sql))
      return { rows: [["current_user"], [who.role ?? who.user ?? ""]] };
    return script(sql, who);
  };
}
