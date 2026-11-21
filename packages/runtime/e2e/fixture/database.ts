// Test page: endue.database (plugins/database) over the desk.* policies on the browser stub, with a
// saved SQLite connection and proc.spawn answered by the plugin's scripted sqlite3 over a fixture
// database (plugins/database/tests/fixtures.ts: people, orders, and staff with a team), a saved
// PostgreSQL connection whose scripted psql has one table of typed columns (items, fixtures-pg.ts),
// one whose scripted psql answers the maintenance form (maintenance-fixture.ts), the activity view
// (activity-fixture.ts) and EXPLAIN with fixture plans (fixture-plans.ts), one whose scripted psql
// answers the server overview (overview-fixture.ts), `select * from many` with 500 rows of 240
// columns (120,000 cells, past the 100,000 a copy asks first at: database-copy.spec.ts), and fs.*
// over a folder in memory with one .sql file (`window.__files`, what saves wrote). Never shipped.
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
import type { Script } from "../../../../plugins/database/tests/clients";
import {
  FIXTURE_CONNECTION,
  FIXTURE_PG_CONNECTION,
  fixtureScript,
  procHandlers,
} from "../../../../plugins/database/tests/fixtures";
import { maintenanceServer } from "../../../../plugins/database/tests/maintenance-fixture";
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
};
// Built when it is first asked for: 500 rows (a console's default limit) of 240 columns (#504).
let many: string[][] | undefined;
const manyRows: (next: Script) => Script = (next) => (sql, env) => {
  if (!/^select \* from many\b/iu.test(sql.trim())) return next(sql, env);
  many ??= [
    ["n", ...Array.from({ length: 239 }, (_, c) => `c${c + 2}`)],
    ...Array.from({ length: 500 }, (_, i) => [`${i + 1}`, ...Array(239).fill(`${i % 10}`)]),
  ];
  return { rows: many };
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
    ],
    // The .sql file runs on the fixture connection, so opening it asks for none.
    "sql-files": [{ path: "~/queries/report.sql", connection: FIXTURE_CONNECTION.id }],
  }),
  handlers: {
    // The overview answers its own statements exactly, then the maintenance form its own, before
    // the activity view's looser matches.
    ...procHandlers(
      manyRows(overviewServer(maintenanceServer(activityServer(fixtureScript).script).script)),
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
