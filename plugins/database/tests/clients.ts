// The scripted psql and sqlite3: what a run would print, in each client's real protocol (markers read
// from the arguments, CSV or quote mode), from a script that answers each statement. The unit tests'
// harness and the runtime e2e page (packages/runtime/e2e/fixture/database.ts) share them, so this
// file imports nothing the browser cannot load.

/** What a scripted statement gives back: rows (the first is the header), changes, or an error. */
export interface Answer {
  rows?: string[][];
  changes?: number;
  error?: string;
}
export type Script = (sql: string, env: Record<string, string>) => Answer | "auth";

export interface Reply {
  stdout: string;
  stderr: string;
  code: number;
}

/** What `<client> --version` prints. */
export const VERSIONS: Record<string, string> = {
  psql: "psql (PostgreSQL) 17.6\n",
  sqlite3: "3.50.6 2025-09-22 18:50:24 9cc5\n",
  mysql: "mysql  Ver 8.4.13 for Linux on aarch64 (MySQL Community Server - GPL)\n",
};

const quote = (value: string) =>
  /^-?\d+(\.\d+)?$/u.test(value) ? value : `'${value.replaceAll("'", "''")}'`;

/** sqlite3's answer to a run: each statement's rows in quote mode, then its marker's total. */
export function sqliteRun(args: string[], script: Script, env: Record<string, string>): Reply {
  let stdout = "";
  let total = 0;
  for (let i = 0; i < args.length; i++) {
    const marker = /^SELECT total_changes\(\) AS "(.*)"$/u.exec(args[i + 1] ?? "");
    if (!marker) continue;
    const answer = script(args[i] ?? "", env);
    if (answer === "auth") throw new Error("sqlite3 has no passwords");
    if (answer.error) return { stdout, stderr: `Error: in prepare, ${answer.error}\n`, code: 1 };
    for (const row of answer.rows ?? []) stdout += `${row.map(quote).join(",")}\n`;
    total += answer.changes ?? 0;
    stdout += `'${marker[1]}'\n${total}\n`;
    i++;
  }
  return { stdout, stderr: "", code: 0 };
}

/** psql's answer: CSV per statement, \echo and \warn markers after each. */
export function psqlRun(args: string[], script: Script, env: Record<string, string>): Reply {
  let stdout = "";
  let stderr = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "-c" || (args[i + 1] ?? "").startsWith("\\")) continue;
    const sql = args[i + 1] ?? "";
    const echo = /^\\echo (\S+) :ROW_COUNT$/u.exec(args[i + 3] ?? "");
    const answer = script(sql, env);
    if (answer === "auth")
      return {
        stdout,
        stderr:
          'psql: error: connection to server at "db" failed: fe_sendauth: no password supplied\n',
        code: 2,
      };
    if (answer.error) return { stdout, stderr: `${stderr}ERROR:  ${answer.error}\n`, code: 1 };
    for (const row of answer.rows ?? []) stdout += `${row.join(",")}\n`;
    if (!echo) {
      i += 1;
      continue;
    }
    stdout += `${echo[1]} ${answer.rows ? answer.rows.length - 1 : (answer.changes ?? 0)}\n`;
    stderr += `${echo[1]}\n`;
    i += 5;
  }
  return { stdout, stderr, code: 0 };
}

/** What `command` prints for `args`: its version, or the script's answers. */
export function scriptedReply(
  command: string,
  args: string[],
  script: Script,
  env: Record<string, string>,
): Reply {
  if (args[0] === "--version") return { stdout: VERSIONS[command] ?? "", stderr: "", code: 0 };
  return command === "psql" ? psqlRun(args, script, env) : sqliteRun(args, script, env);
}
