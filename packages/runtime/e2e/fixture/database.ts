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
// value search over two schemas of tables (search-fixture.ts) and the source search's definitions
// there (source-search-fixture.ts), the map's parcels and twenty
// thousand squares as geometry values on every PostgreSQL connection (geo-fixture.ts), the roles,
// ACLs, policies and default privileges of the privileges panel on every PostgreSQL connection
// (privileges-fixture.ts), and fs.* over a folder in memory with one .sql file (`window.__files`,
// what saves and exports wrote). dialog.save answers a place in ~/Pictures for an image and the
// backup's place otherwise; a backup's save and open dialogs, and the scripted pg_dump and
// pg_restore, are backup-fixture.ts's. A connections file waits in ~/Transfer for an import, whose
// open dialog answers it; an export's save dialog answers a place there. fixture-pg's server has more
// databases (databases-fixture.ts, PG-13). Never shipped.
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
import { stockScript } from "../../../../plugins/database/tests/compare-fixture";
import { schemaCompareServer } from "../../../../plugins/database/tests/compare-schema-fixture";
import { withDatabases } from "../../../../plugins/database/tests/databases-fixture";
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
import { privilegesServer } from "../../../../plugins/database/tests/privileges-fixture";
import { routineServer } from "../../../../plugins/database/tests/routine-fixture";
import { SEARCH_CONNECTION, searchServer } from "../../../../plugins/database/tests/search-fixture";
import { sourceServer } from "../../../../plugins/database/tests/source-search-fixture";
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
const TRANSFER = "~/Transfer/team-connections.json";
const files: Record<string, string> = {
  "~/queries/report.sql": "select * from orders;\n",
  [TRANSFER]: `${JSON.stringify({
    format: "endue.database.connections",
    version: 1,
    exported: "2026-11-22T09:00:00.000Z",
    connections: [
      { ...FIXTURE_CONNECTION, tag: "staging", readOnly: true },
      {
        ...FIXTURE_CONNECTION,
        id: "c-team-reports",
        name: "team reports",
        file: "~/reports.db",
        group: "Team",
        color: "chart-3",
      },
      { ...FIXTURE_CONNECTION, id: "c-team-wh", name: "Warehouse", file: "~/warehouse.db" },
    ],
  })}\n`,
};
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
// `stock` changes from one read to the next, for the comparison (compare-fixture.ts).
const procs = procHandlers(stockScript(fixtureScript), (event) => emit(event));
const backup = backupHandlers(
  files,
  procs["proc.spawn"] as NonNullable<StubHandlers["proc.spawn"]>,
);
const backupSave = backup["dialog.save"] as NonNullable<StubHandlers["dialog.save"]>;
const backupOpen = backup["dialog.open"] as NonNullable<StubHandlers["dialog.open"]>;
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
    // The privileges panel's and the map's statements answer first, exactly; then the diagram's
    // connection and the value search's, each by its database; the table form, the routine forms
    // and the overview answer their own statements exactly, then the maintenance form its own and
    // the objects feature its own, before the activity view's looser matches.
    // fixture-pg's other databases answer before all of them (PG-13), then the schema comparison's
    // reads, which carry their own marker (PG-53).
    ...dbHandlers(
      withDatabases(
        schemaCompareServer(
          privilegesServer(
            geoServer(
              diagramServer(
                sourceServer(
                  searchServer(
                    tableDesignServer(
                      routineServer(
                        overviewServer(
                          maintenanceServer(
                            objectsServer(activityServer(fixtureScript).script).script,
                          ).script,
                        ),
                      ).script,
                    ).script,
                  ),
                  { materialized: false },
                ),
              ),
            ),
          ).script,
        ).script,
      ),
      (event) => emit(event),
    ),
    ...fsHandlers,
    ...backup,
    // An exported image goes to ~/Pictures, exported connections to ~/Transfer; anything else is
    // the backup's to place.
    "dialog.save": (params, caller) =>
      /\.(?:svg|png)$/u.test(params.suggestedName ?? "")
        ? { cancelled: false, path: `~/Pictures/${params.suggestedName}` }
        : /\.json$/u.test(params.suggestedName ?? "")
          ? { cancelled: false, path: `~/Transfer/${params.suggestedName}` }
          : backupSave(params, caller),
    "dialog.open": (params, caller) =>
      /connections/u.test(params.title ?? "")
        ? { cancelled: false, paths: [TRANSFER] }
        : backupOpen(params, caller),
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
