// What the console session tests share (PG-02, ADR 0320): a PostgreSQL connection of no environment,
// a scripted server that fails `select 1/0`, sleeps on pg_sleep and answers `select * from seen`, and
// helpers that type and run SQL in the console on screen and read which session ran what.
import type { Connection } from "../ui/engines/common.js";
import { type Mounted, mount, type Script } from "./harness";
import { runsOf } from "./runs-of";

export const PG: Connection = {
  id: "c-pg",
  name: "Shop",
  engine: "postgresql",
  host: "db.example",
  port: 5432,
  database: "shop",
  user: "app",
  ssl: "default",
  sslCa: "",
  file: "",
  tag: "none",
  readOnly: false,
};

export const script: Script = (sql) => {
  if (sql === "select 1/0") return { error: "division by zero", code: "22012" };
  if (/pg_sleep/u.test(sql)) return { waits: true };
  if (sql.startsWith("select * from seen")) return { rows: [["id"], ["1"]] };
  return {};
};

/** The plugin with `conns` saved and the first one's console on screen. */
export async function shop(
  options: Parameters<typeof mount>[0] = {},
  conns: Connection[] = [PG],
): Promise<Mounted> {
  const m = await mount({ store: { connections: conns }, script, ...options });
  await m.host.command("endue.database.console", { connection: conns[0]?.name });
  return m;
}

/** Type `sql` into the console on screen and run it with `command`. */
export async function run(m: Mounted, sql: string, command = "endue.database.run-all") {
  m.view.text = sql;
  m.view.caret = sql.length;
  m.app.edited(sql);
  const done = await m.host.command(command);
  await m.settle();
  return done;
}

/**
 * Start `sql` in the console on screen and wait until it reaches its session, without settling:
 * a statement that waits keeps its call open. The run's end comes back.
 */
export async function start(m: Mounted, sql: string) {
  m.view.text = sql;
  m.view.caret = sql.length;
  m.app.edited(sql);
  const done = m.host.command("endue.database.run-all");
  for (let i = 0; i < 200 && !sessionOf(m, sql); i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  if (!sessionOf(m, sql)) throw new Error(`${sql} never ran`);
  return { done };
}

type Call = { method: string; params?: unknown };
const params = (call: Call) => (call.params ?? {}) as Record<string, unknown>;

/** The session the first db.run of `sql` went to. */
export const sessionOf = (m: Mounted, sql: string) =>
  params(
    runsOf(m.host.calls).find((c) => c.method === "db.run" && params(c).sql === sql) ?? {
      method: "",
    },
  ).sessionId as string | undefined;

/** Every statement a session ran, in order. */
export const ranOn = (m: Mounted, sessionId: string | undefined) =>
  runsOf(m.host.calls)
    .filter((c) => c.method === "db.run" && params(c).sessionId === sessionId)
    .map((c) => params(c).sql);

/** The sessions the plugin closed (db.close), in order. */
export const closed = (m: Mounted) =>
  m.host.calls.filter((c) => c.method === "db.close").map((c) => params(c).sessionId);

/** Every db.call of `method`, its params. */
export const made = (m: Mounted, method: string) =>
  runsOf(m.host.calls)
    .filter((c) => c.method === method)
    .map(params);

/** The session state the header shows for the buffer on screen. */
export const state = (m: Mounted) => m.shown()?.session?.state;

/** The lines of the Messages tab of the buffer on screen. */
export const messages = (m: Mounted) =>
  (m.shown()?.shown?.tabs ?? []).flatMap((t) => t.lines ?? []).map((l) => l.text);
