// What a live test sets up on the server itself, on the desk core's sessions (core-bridge.ts) rather
// than through the plugin: one statement as the URI's role, and named sessions that hold a lock or
// sleep while the plugin looks at them. `endAll` lets go of every session it opened.
import type { DbPage } from "../../../packages/bridge/src/index";
import { serverSession } from "./core-bridge";

type Own = Awaited<ReturnType<typeof serverSession>>;

export function liveSessions(uri: string, prefix: string) {
  const opened: Own[] = [];
  return {
    /** One statement as the URI's role; the first value of its result, as text. */
    async admin(sql: string) {
      const own = await serverSession(uri, `${prefix} admin`);
      try {
        return await own.run(sql);
      } finally {
        await own.close();
      }
    },
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
          // A session the test's end terminates ends its statement with an error of its own.
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
    /** End this database's sessions named after `prefix` (one asleep included), then let go. */
    async endAll() {
      const own = await serverSession(uri, `${prefix} admin`);
      await own
        .run(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND application_name LIKE '${prefix} %' AND pid <> pg_backend_pid()`,
        )
        .finally(() => own.close());
      await Promise.all(opened.map((session) => session.close()));
    },
  };
}
