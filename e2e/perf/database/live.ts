// The plugin as the live tests mount it (plugins/database/tests/harness.ts): the real controller,
// engines and sessions, PostgreSQL through the desk core's sessions (core-bridge.ts), on the
// server ENDUE_DB_TEST_POSTGRES names. The recording view copies every console model it is shown,
// which costs what the desk's view does not: here it keeps the last one only, as drawn.

import { type Mounted, mount } from "../../../plugins/database/tests/harness";
import { liveSessions } from "../../../plugins/database/tests/live-sessions";
import { realProcs } from "../../../plugins/database/tests/scripted";
import { normalize, parseUri } from "../../../plugins/database/ui/connections.js";
import type { Connection, ResultSet } from "../../../plugins/database/ui/engines/common.js";

export const URI = process.env.ENDUE_DB_TEST_POSTGRES ?? "";
export const PREFIX = "endue perf";
export const server = liveSessions(URI, PREFIX);

const granted = { "perm.query": () => ({ grants: [{ permission: "db:connect" }] }) as never };

export function liveConnection(id: string): Connection {
  const { fields } = URI ? parseUri(URI) : { fields: {} };
  return normalize({ ...fields, id, name: "live" }) as Connection;
}

/**
 * The plugin mounted on the live server, `settings` set, over `store` (what a start before kept);
 * the view keeps its last console.
 */
export async function live(
  conn: Connection,
  settings: Record<string, unknown> = {},
  store: Record<string, unknown> = { connections: [conn] },
) {
  const { password } = URI ? parseUri(URI) : { password: undefined };
  const procs = realProcs(password ? { password } : {});
  const m = await mount({
    store: { ...store },
    handlers: { ...procs.handlers, ...granted },
    pick: () => "yes",
  });
  procs.attach((event) => m.host.emit(event));
  for (const [key, value] of Object.entries(settings))
    await m.host.call("settings.set", { key, value }, "endue.database");
  m.view.console = (model, c) => {
    m.view.consoles.splice(0, m.view.consoles.length, { model, conn: c });
  };
  await m.settle();
  return m;
}

/** The rows tab's result on screen. */
export const shownSet = (m: Mounted) =>
  m.shown()?.shown?.tabs.find((t) => t.kind === "rows")?.set as ResultSet | undefined;

/** Type `sql` into the console on screen and run it; settles once it has answered. */
export async function runIn(m: Mounted, sql: string) {
  m.view.text = sql;
  m.view.caret = sql.length;
  m.app.edited(sql);
  await m.host.command("endue.database.run");
}

export const disconnect = (m: Mounted) =>
  m.host.command("endue.database.disconnect", { connection: "live" });
