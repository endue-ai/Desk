// The maintenance form's tests on the SDK's test host (maintenance.test.ts, maintenance-run.test.ts):
// the plugin on the scripted PostgreSQL of maintenance-fixture.ts, with a production connection, a
// read-only one and a SQLite one, its db.run able to hold a run open, and explorer rows.
import { stubDb } from "../../../packages/bridge/src/index";
import type { Connection } from "../ui/engines/common.js";
import type { Node } from "../ui/explorer.js";
import { ACTIVITY_CONNECTION } from "./activity-fixture";
import { type Answer, type Script, scriptedDb } from "./clients";
import { type Handlers, type Mounted, mount, SAVED } from "./harness";
import { maintenanceServer } from "./maintenance-fixture";

const NOTES = SAVED[0] as Connection;
const conn = (fields: Partial<Connection>): Connection => ({ ...ACTIVITY_CONNECTION, ...fields });
const PROD = conn({ id: "c-prod-wh", name: "prod", tag: "production" });
const LOCKED = conn({ id: "c-ro-wh", name: "locked", readOnly: true });
export const MAINTENANCE = /^(VACUUM|ANALYZE|REINDEX|CLUSTER)\b/u;

/** The catalog the palette's picks read: schema public and its tables. */
const catalog: Script = (sql) => {
  if (/FROM pg_catalog\.pg_namespace WHERE nspname/u.test(sql))
    return { rows: [["nspname"], ["public"]] };
  if (sql.startsWith("SELECT c.relname, CASE c.relkind"))
    return {
      rows: [
        ["name", "kind", "detail", "estimate", "ident"],
        ["daily_totals", "materialized view", "", "365", "1"],
        ["orders", "table", "", "120000", "2"],
        ["recent", "view", "", "", "3"],
        ["stock", "table", "", "500", "4"],
      ],
    };
  return {};
};

/**
 * The plugin on the scripted server. With `hold`, a maintenance statement's db.run stays open until
 * `finish` answers it (the scripted answer, or the one given), as a long run on a real server.
 * `sent` holds each session's statements, in order.
 */
export async function start(
  options: {
    pick?: (args: { title: string }) => string;
    version?: number;
    recovery?: boolean;
    hold?: boolean;
  } = {},
) {
  const server = maintenanceServer(catalog, options);
  const held: Array<{ args: string[]; finish(answer?: Answer): void }> = [];
  const sent: string[][] = [];
  const bySession = new Map<string, string[]>();
  let m: Mounted | undefined;
  let override: Answer | undefined;
  const db = stubDb(
    scriptedDb((sql, who) => override ?? server.script(sql, who)),
    () => {},
    (event) => queueMicrotask(() => m?.host.emit(event as never)),
  ).handlers as unknown as Record<
    string,
    (params: Record<string, unknown>, caller?: string) => unknown
  >;
  const run = db["db.run"] as (
    params: { sessionId: string; sql: string },
    caller?: string,
  ) => unknown;
  const handlers = {
    ...db,
    "db.run": (params: { sessionId: string; sql: string }, caller?: string) => {
      let statements = bySession.get(params.sessionId);
      if (!statements) {
        statements = [];
        bySession.set(params.sessionId, statements);
        sent.push(statements);
      }
      statements.push(params.sql);
      if (!options.hold || !MAINTENANCE.test(params.sql)) return run(params, caller);
      return new Promise((resolve) => {
        held.push({
          args: statements,
          finish: (answer) => {
            // The stub reads its script as db.run starts: the answer holds for this run only.
            override = answer;
            const page = run(params, caller);
            override = undefined;
            resolve(page);
          },
        });
      });
    },
  } as unknown as Handlers;
  m = await mount({
    store: { connections: [ACTIVITY_CONNECTION, NOTES, PROD, LOCKED] },
    handlers,
    pick: options.pick ?? (() => "yes"),
  });
  return { m, server, held, sent };
}
export const acts = (m: Mounted) =>
  m.app as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
export const node = (fields: Partial<Node>): Node =>
  ({
    key: "k",
    label: "orders",
    detail: "",
    level: 3,
    expandable: false,
    expanded: false,
    connection: "c-warehouse",
    ...fields,
  }) as Node;
export const ORDERS = node({
  kind: "table",
  schema: "public",
  table: "orders",
  object: { schema: "public", name: "orders", kind: "table", detail: "", rows: 120000, ident: "2" },
});
/** The statements a session ran (BEGIN and COMMIT included: a run in one transaction shows them). */
export const statementsOf = (statements: string[]) => statements;
