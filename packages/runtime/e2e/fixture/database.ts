// Test page: endue.database (plugins/database) over the desk.* policies on the browser stub, with a
// saved SQLite connection and proc.spawn answered by the plugin's scripted sqlite3 over a fixture
// database (plugins/database/tests/fixtures.ts: two tables, people and orders), and after it a saved
// PostgreSQL connection whose scripted psql answers the server overview (overview-fixture.ts).
// Never shipped.
import type { BridgeEvent, PluginManifest } from "@endue-ai/bridge";
import databaseManifest from "../../../../plugins/database/plugin.json";
import {
  FIXTURE_CONNECTION,
  fixtureScript,
  procHandlers,
} from "../../../../plugins/database/tests/fixtures";
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
const clock = new ManualClock();
const core = browserCore({
  manifests: [...policies, databaseManifest as PluginManifest],
  store: memoryStore({ connections: [FIXTURE_CONNECTION, OVERVIEW_CONNECTION] }),
  handlers: procHandlers(overviewServer(fixtureScript), (event) => emit(event)),
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
