// Test page: endue.projects (plugins/projects) over the desk.* policies on the browser stub, with the
// index answering from the plugin's own fixtures (plugins/projects/tests/fixtures.ts: Jira, Linear,
// Asana and one more connector's tasks, due around 30 October 2026). Never shipped.
//   ?empty=1   nothing connected: GitHub is installed and brings tasks, the index holds none
import type { PluginManifest, StubHandlers, TaskItem } from "@endue-ai/bridge";
import projectsManifest from "../../../../plugins/projects/plugin.json";
import { sample } from "../../../../plugins/projects/tests/fixtures";
import "../../src/desk.css";
import { browserCore } from "../../src/bridge/core";
import { createRuntime, ManualClock } from "../../src/index";

const params = new URLSearchParams(location.search);
const manifests = import.meta.glob<PluginManifest>("../../../../plugins/*/plugin.json", {
  eager: true,
  import: "default",
});
const policies = Object.values(manifests).filter(
  (m) => m.id.startsWith("desk.") && m.id !== "desk.shell" && m.kind === "policy",
);

const items: TaskItem[] = params.has("empty") ? [] : sample();
const connectors = [...new Set(items.map((i) => i.source.connector))];
/** The index and the connectors as the plugin's data:read and connector:manage grants see them. */
const handlers: StubHandlers = {
  "data.query": () => ({ items: structuredClone(items) }),
  "data.subscribe": () => ({ subscriptionId: "projects-fixture" }),
  "catalog.get": () => ({
    components: [],
    commands: [],
    connectors: connectors.map((id) => ({
      id,
      instances: [
        ...new Set(items.filter((i) => i.source.connector === id).map((i) => i.source.instance)),
      ],
      kinds: [{ kind: "task" as const, fields: [] }],
    })),
  }),
  "connector.list": () => ({
    connectors: [
      { id: "desk.github", title: "GitHub", instances: [], resources: [{ kind: "task" }] },
    ],
  }),
};

const clock = new ManualClock();
const core = browserCore({
  manifests: [...policies, projectsManifest as PluginManifest],
  handlers,
  open: () => {},
});
const runtime = createRuntime({
  root: document.getElementById("desk") as HTMLElement,
  bridge: core.client,
  clock,
  platform: "other",
  plugins: { url: (id, path, revision) => `/plugins/${id}/${path}?v=${revision}` },
});

window.__desk = { clock, runtime, stub: core.stub, commands: [] };
