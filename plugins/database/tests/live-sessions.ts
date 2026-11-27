// What a live test sets up on the server itself, on the desk core's sessions (core-bridge.ts) rather
// than through the plugin: one statement as the URI's role, and named sessions that hold a lock or
// sleep while the plugin looks at them. Other runs use the same server at once, each in a database
// of its own: only this database's sessions are ended, and the test's own statements wait 30 s at
// most behind a lock another run left.
import type { DbPage } from "../../../packages/bridge/src/index";
import { APPLICATION } from "../ui/engines/pg-session.js";
import { serverSession } from "./core-bridge";

/** Match the same default client name that this version opens on the test database. */
export const appSessions = `application_name = '${APPLICATION.replaceAll("'", "''")}'`;

type Own = Awaited<ReturnType<typeof serverSession>>;

/** The database a URI names: the one whose sessions a test may look up and end. */
export const databaseOf = (uri: string) => (uri ? new URL(uri).pathname.slice(1) : "");

export function liveSessions(uri: string, prefix: string) {
  const opened: Own[] = [];
  const admin = async (sql: string) => {
    const own = await serverSession(uri, `${prefix} admin`, { lock_timeout: "30s" });
    try {
      return await own.run(sql);
    } finally {
      await own.close();
    }
  };
  return {
    /** One statement as the URI's role; the first value of its result, as text. */
    admin,
    /**
     * A session of its own named `${prefix} ${name}`, running `sqls` one by one; `close` ends it
     * after the last. `done` settles with the error message that stopped it, "" when none did.
     */
    session(name: string, sqls: string[], close = false) {
      let err = "";
      const done = (async () => {
        const own = await serverSession(uri, `${prefix} ${name}`);
        opened.push(own);
        for (const sql of sqls) {
          // A session the test ends ends its statement with an error of its own.
          const page: DbPage | Error = await own.page(sql).catch((error: Error) => error);
          const failed = page instanceof Error ? page : page.error;
          if (failed) {
            err = failed.message;
            break;
          }
        }
        if (close) await own.close();
        return err;
      })();
      return { done, err: () => err };
    },
    /**
     * End this database's sessions named after `prefix` (and those `also` matches, a condition on
     * pg_stat_activity), one asleep holding a lock included, then let go of them: before a drop or
     * a setup, which would wait behind their locks.
     */
    async end(also = "false") {
      await admin(
        `SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND (application_name LIKE '${prefix} %' OR ${also})`,
      );
      await Promise.all(opened.splice(0).map((session) => session.close()));
    },
  };
}
