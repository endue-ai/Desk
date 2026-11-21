// The maintenance form's tests on the SDK's test host (maintenance.test.ts, maintenance-run.test.ts):
// the plugin on the scripted PostgreSQL of maintenance-fixture.ts, with a production connection, a
// read-only one and a SQLite one, its proc.spawn able to hold a run open, and explorer rows.
import type { Connection } from "../ui/engines/common.js";
import type { Node } from "../ui/explorer.js";
import { ACTIVITY_CONNECTION } from "./activity-fixture";
import { type Answer, type Script, scriptedReply } from "./clients";
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
 * The plugin on the scripted server. With `hold`, a maintenance run's psql stays open until
 * `finish` answers it (the scripted answer, or the one given), as a long run on a real server.
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
  let m: Mounted | undefined;
  let n = 0;
  const handlers = {
    "proc.spawn": (params: { command: string; args?: string[]; env?: Record<string, string> }) => {
      const args = params.args ?? [];
      const env = params.env ?? {};
      sent.push(args);
      const procId = `h-${++n}`;
      const emit = (script: Script) => {
        const reply = scriptedReply(params.command, args, script, env);
        setTimeout(() => {
          for (const stream of ["stdout", "stderr"] as const)
            if (reply[stream])
              m?.host.emit({
                event: "proc.output",
                data: { procId, stream, data: reply[stream], encoding: "utf8" },
              });
          m?.host.emit({ event: "proc.exit", data: { procId, code: reply.code } });
        }, 0);
      };
      if (options.hold && args.some((a) => MAINTENANCE.test(a)))
        held.push({ args, finish: (answer) => emit(answer ? () => answer : server.script) });
      else emit(server.script);
      return { procId, pid: 100 + n };
    },
    "proc.kill": () => ({}),
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
/** The -c statements a psql run was given, without its markers. */
export const statementsOf = (args: string[]) =>
  args.filter((a, i) => args[i - 1] === "-c" && !a.startsWith("\\"));
