// Test page: endue.database (plugins/database) over the desk.* policies on the browser stub, with a
// saved SQLite connection and proc.spawn answered by the plugin's scripted sqlite3 over a fixture
// database (plugins/database/tests/fixtures.ts: people, orders, and staff with a team), a saved
// PostgreSQL connection whose scripted server (db.*, the stub's sessions) has one table of typed
// columns (items, fixtures-pg.ts), one whose server answers the maintenance form
// (maintenance-fixture.ts), the activity view (activity-fixture.ts), EXPLAIN with fixture plans
// (fixture-plans.ts) and the reads and DDL of the explorer's operations on objects
// (objects-fixture.ts), one whose server answers the server overview (overview-fixture.ts), one
// whose server answers the schema cache with a small store and a schema of 500 tables and 1,000
// foreign keys for the ER diagram (diagram-fixture.ts), the routine forms' functions and
// procedures on every PostgreSQL connection (routine-fixture.ts), one whose server answers the
// value search over two schemas of tables (search-fixture.ts), the map's parcels and twenty
// thousand squares as geometry values on every PostgreSQL connection (geo-fixture.ts), and fs.* over
// a folder in memory with one .sql file (`window.__files`, what saves and exports wrote).
// dialog.save answers a place in ~/Pictures for an image and the backup's place otherwise; a
// backup's save and open dialogs, and the scripted pg_dump and pg_restore, are backup-fixture.ts's.
// Never shipped.
import {
  type BridgeEvent,
  type PluginManifest,
  StubError,
  type StubHandlers,
} from "@endue-ai/bridge";
import databaseManifest from "../../../../plugins/database/plugin.json";
import {
  ACTIVITY_CONNECTION,
  activityServer,
} from "../../../../plugins/database/tests/activity-fixture";
import { backupHandlers } from "../../../../plugins/database/tests/backup-fixture";
import {
  DIAGRAM_CONNECTION,
  diagramServer,
} from "../../../../plugins/database/tests/diagram-fixture";
import {
  dbHandlers,
  FIXTURE_CONNECTION,
  FIXTURE_PG_CONNECTION,
  fixtureScript,
  procHandlers,
} from "../../../../plugins/database/tests/fixtures";
import { geoServer } from "../../../../plugins/database/tests/geo-fixture";
import { maintenanceServer } from "../../../../plugins/database/tests/maintenance-fixture";
import { objectsServer } from "../../../../plugins/database/tests/objects-fixture";
import {
  OVERVIEW_CONNECTION,
  overviewServer,
} from "../../../../plugins/database/tests/overview-fixture";
import { routineServer } from "../../../../plugins/database/tests/routine-fixture";
import { SEARCH_CONNECTION, searchServer } from "../../../../plugins/database/tests/search-fixture";
import { tableDesignServer } from "../../../../plugins/database/tests/table-design-fixture";
import "../../src/desk.css";
import { browserCore, memoryStore } from "../../src/bridge/core";
import { createRuntime, ManualClock } from "../../src/index";

const manifests = import.meta.glob<PluginManifest>("../../../../plugins/*/plugin.json", {
  eager: true,
  import: "default",
});
const policies = Object.values(manifests).filter(
  (m) => m.id.startsWith("desk.") && m.id !== "desk.shell" && m.kind === "policy",
);

let emit: (event: BridgeEvent) => void = () => {};
const files: Record<string, string> = { "~/queries/report.sql": "select * from orders;\n" };
(window as unknown as { __files: Record<string, string> }).__files = files;
const fsHandlers: StubHandlers = {
  "fs.read": ({ path, offset, length, encoding }) => {
    const text = files[path];
    if (text === undefined) throw new StubError("not_found", `${path}: no such file`);
    const bytes = new TextEncoder().encode(text);
    const part = bytes.subarray(
      offset ?? 0,
      length === undefined ? undefined : (offset ?? 0) + length,
    );
    const content =
      encoding === "base64" ? btoa(String.fromCharCode(...part)) : new TextDecoder().decode(part);
    return { content, encoding: encoding ?? "utf8", size: bytes.length };
  },
  "fs.write": ({ path, content }) => {
    files[path] = content;
    return { bytesWritten: content.length };
  },
  "fs.watch": () => ({ watchId: "w-fixture" }),
};
// sqlite3 runs scripted; backupHandlers adds pg_dump and pg_restore in front of it.
const procs = procHandlers(fixtureScript, (event) => emit(event));
const backup = backupHandlers(
  files,
  procs["proc.spawn"] as NonNullable<StubHandlers["proc.spawn"]>,
);
const backupSave = backup["dialog.save"] as NonNullable<StubHandlers["dialog.save"]>;
const clock = new ManualClock();
const core = browserCore({
  manifests: [...policies, databaseManifest as PluginManifest],
  store: memoryStore({
    connections: [
      FIXTURE_CONNECTION,
      FIXTURE_PG_CONNECTION,
      ACTIVITY_CONNECTION,
      OVERVIEW_CONNECTION,
      DIAGRAM_CONNECTION,
      SEARCH_CONNECTION,
    ],
    // The .sql file runs on the fixture connection, so opening it asks for none.
    "sql-files": [{ path: "~/queries/report.sql", connection: FIXTURE_CONNECTION.id }],
  }),
  handlers: {
    ...procs,
    // The map's statements answer first, exactly; then the diagram's connection and the value
    // search's, each by its database; the table form, the routine forms and the overview answer
    // their own statements exactly, then the maintenance form its own and the objects feature its
    // own, before the activity view's looser matches.
    ...dbHandlers(
      geoServer(
        diagramServer(
          searchServer(
            tableDesignServer(
              routineServer(
                overviewServer(
                  maintenanceServer(objectsServer(activityServer(fixtureScript).script).script)
                    .script,
                ),
              ).script,
            ).script,
          ),
        ),
      ),
      (event) => emit(event),
    ),
    ...fsHandlers,
    ...backup,
    // An exported image goes to ~/Pictures; anything else is the backup's to place.
    "dialog.save": (params, caller) =>
      /\.(?:svg|png)$/u.test(params.suggestedName ?? "")
        ? { cancelled: false, path: `~/Pictures/${params.suggestedName}` }
        : backupSave(params, caller),
  },
  open: () => {},
});
emit = (event) => core.stub.emit(event);
const runtime = createRuntime({
  root: document.getElementById("desk") as HTMLElement,
  bridge: core.client,
  clock,
  platform: "other",
  plugins: { url: (id, path, revision) => `/plugins/${id}/${path}?v=${revision}` },
});

window.__desk = { clock, runtime, stub: core.stub, commands: [] };
