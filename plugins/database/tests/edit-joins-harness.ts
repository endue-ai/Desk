// The live tests' plugin on a real PostgreSQL (edit-joins-live.test.ts): the executor on the desk
// core's sessions, as live.test.ts makes it, the catalog, and a console that shows one statement's
// first result, read again as the console does after a Submit.
import { createCatalog } from "../ui/catalog.js";
import { createClients } from "../ui/clients.js";
import { normalize, parseUri } from "../ui/connections.js";
import type { Console } from "../ui/consoles.js";
import type { Connection } from "../ui/engines/common.js";
import { createSessions } from "../ui/engines/pg-session.js";
import { createExecutor } from "../ui/execute.js";
import { createRunner } from "../ui/run.js";
import { fromValues } from "../ui/settings.js";
import { show as shownOf } from "../ui/tabs.js";
import { nodeBridge } from "./node-bridge";
import { inProcessOutput } from "./output";

export function editHarness(given: string) {
  const { fields, password } = parseUri(given);
  const conn = normalize({ ...fields, id: "c-live", name: "live", readOnly: false });
  const bridge = nodeBridge();
  const runner = createRunner(bridge);
  const settings = fromValues({ "endue.database.max-rows": 100 });
  const executor = createExecutor({
    runner,
    output: inProcessOutput(),
    clients: createClients(runner, () => settings),
    sessions: createSessions(bridge),
    settings: () => settings,
    confirm: async () => true,
    passwords: { get: () => password, set: () => {}, ask: async () => undefined },
    cancelled: (message) => new Error(message),
  });
  const execute = executor.execute;
  const run = (sql: string) => execute(conn, sql);
  /** Run `sql` into `into` (a new console when none): its first result on screen, no edit yet. */
  const show = async (sql: string, into?: Console) => {
    const execution = await run(sql);
    const failed = execution.result.statements[0]?.error ?? execution.result.error;
    if (failed) throw new Error(failed.message);
    const console =
      into ?? ({ id: "k1", kind: "console", tab: 0, edit: null } as unknown as Console);
    Object.assign(console, {
      text: sql,
      execution,
      shown: shownOf(execution),
      tab: 0,
    });
    return console;
  };
  return {
    conn,
    execute,
    run,
    show,
    catalog: createCatalog(execute, () => false),
    reload: (target: Console, _conn: Connection) => show(target.text, target),
  };
}
