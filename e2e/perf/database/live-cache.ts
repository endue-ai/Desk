// The plugin's schema cache (PG-06) on the live server through the desk core's sessions, as
// plugins/database/tests/complete-live.test.ts builds it: what completion and the problems read.

import { nodeBridge } from "../../../plugins/database/tests/node-bridge";
import { inProcessOutput } from "../../../plugins/database/tests/output";
import { memoryStore } from "../../../plugins/database/tests/schema-cache-helpers";
import { createClients } from "../../../plugins/database/ui/clients.js";
import { parseUri } from "../../../plugins/database/ui/connections.js";
import { createSessions } from "../../../plugins/database/ui/engines/pg-session.js";
import { createExecutor } from "../../../plugins/database/ui/execute.js";
import { createRunner } from "../../../plugins/database/ui/run.js";
import { createSchemaCache } from "../../../plugins/database/ui/schema-cache/index.js";
import { fromValues } from "../../../plugins/database/ui/settings.js";
import { URI } from "./live";

export function liveCache() {
  const { password } = parseUri(URI);
  const bridge = nodeBridge();
  const runner = createRunner(bridge);
  const settings = fromValues({});
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
  return createSchemaCache({
    execute: (c, sql, options) => executor.execute(c, sql, options),
    store: memoryStore(),
    systemSchemas: () => false,
    changed: () => {},
  });
}
