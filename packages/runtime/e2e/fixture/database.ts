// Test page: endue.database (plugins/database) over the desk.* policies on the browser stub, with a
// saved SQLite connection and proc.spawn answered by the plugin's scripted sqlite3 over a fixture
// database (plugins/database/tests/fixtures.ts: people, orders, and staff with a team), a saved
// PostgreSQL connection whose scripted server (db.*, the stub's sessions) has one table of typed
// columns (items, fixtures-pg.ts), one whose server answers the maintenance form
// (maintenance-fixture.ts), the activity view (activity-fixture.ts), EXPLAIN with fixture plans
// (fixture-plans.ts) and the reads and DDL of the explorer's operations on objects
// (objects-fixture.ts), one whose server answers the server overview (overview-fixture.ts), one
// whose server answers the schema cache with a small store and a schema of 500 tables and 1,000
// foreign keys for the ER diagram (diagram-fixture.ts), dialog.save answering a place in
// ~/Pictures, and fs.* over a folder in memory with one .sql file (`window.__files`, what saves and
// exports wrote). Never shipped.
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
import { maintenanceServer } from "../../../../plugins/database/tests/maintenance-fixture";
import { objectsServer } from "../../../../plugins/database/tests/objects-fixture";
import {
  OVERVIEW_CONNECTION,
  overviewServer,
} from "../../../../plugins/database/tests/overview-fixture";
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
  "dialog.save": ({ suggestedName }) => ({
    cancelled: false,
    path: `~/Pictures/${suggestedName ?? "untitled"}`,
  }),
};
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
    ],
    // The .sql file runs on the fixture connection, so opening it asks for none.
    "sql-files": [{ path: "~/queries/report.sql", connection: FIXTURE_CONNECTION.id }],
  }),
  handlers: {
    ...procHandlers(fixtureScript, (event) => emit(event)),
    // The diagram's connection answers first, by its database; the overview answers its own
    // statements exactly, then the maintenance form its own and the objects feature its own,
    // before the activity view's looser matches.
    ...dbHandlers(
      diagramServer(
        overviewServer(
          maintenanceServer(objectsServer(activityServer(fixtureScript).script).script).script,
        ),
      ),
      (event) => emit(event),
    ),
    ...fsHandlers,
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
