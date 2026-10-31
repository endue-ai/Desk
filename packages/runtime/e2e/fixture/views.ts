/// <reference types="vite/client" />
// Test page: desk.views over the desk.* policies and desk.palette, on the core's stub with the fixture
// connector desk.fixtures and its items (packages/bridge/src/fixtures.ts). It saves the spec's
// view-today and view-table-with-actions and fixture/views/empty.json at start, and plays a test
// caller, example.jira, that provides the table's action commands and records what it gets. Never
// shipped.
//   ?status=error   connector.list answers desk.fixtures/default in error until it syncs
//   ?jira=1         example.jira is connected too, with the fixture tasks and their deep links
import {
  type ConnectorInfo,
  type ConnectorStatus,
  fixtureConnector,
  fixtureItems,
  type Item,
  type ItemSource,
  type PluginManifest,
  type View,
} from "@endue-ai/bridge";
import table from "../../../../specs/view/v0/vectors/valid/view-table-with-actions.json";
import today from "../../../../specs/view/v0/vectors/valid/view-today.json";
import "../../src/desk.css";
import { browserCore } from "../../src/bridge/core";
import { createRuntime, ManualClock } from "../../src/index";
import empty from "./views/empty.json";

const params = new URLSearchParams(location.search);
const manifests = import.meta.glob<PluginManifest>("../../../../plugins/*/plugin.json", {
  eager: true,
  import: "default",
});
const JIRA = "example.jira";
const key = (connector: string, instance: string) => `${connector}/${instance}`;

// The instances' status as the core would list it: what the fixtures say, an error under
// ?status=error, and whatever connector.changed said since (a sync brings an instance back).
const statuses = new Map<string, ConnectorStatus>();
if (params.get("status") === "error")
  statuses.set(key("desk.fixtures", "default"), {
    state: "error",
    lastSyncAt: "2026-10-30T08:55:00+09:00",
    error: { message: "The fixture source stopped answering." },
  });
const jira: ConnectorInfo = {
  id: JIRA,
  resources: [{ kind: "task", actions: ["example.jira.done", "example.jira.open"] }],
  instances: [
    {
      connector: JIRA,
      instance: "default",
      title: "Jira",
      settings: {},
      status: { state: "connected", lastSyncAt: "2026-10-30T08:50:00+09:00" },
    },
  ],
};
const listed = (): ConnectorInfo[] => {
  const { id, resources, instances } = fixtureConnector();
  const all = [{ id, resources, instances }, ...(params.has("jira") ? [jira] : [])];
  return all.map((c) => ({
    ...c,
    instances: c.instances.map((i) => ({
      ...i,
      status: statuses.get(key(i.connector, i.instance)) ?? i.status,
    })),
  }));
};

const clock = new ManualClock();
const core = browserCore({
  // The bare desk, the palette and the view engine: every desk.* plugin but the shell's own.
  manifests: Object.values(manifests).filter(
    (m) => m.id.startsWith("desk.") && m.id !== "desk.shell",
  ),
  handlers: { "connector.list": () => ({ connectors: listed() }) },
});
const { client, stub } = core;

/** What example.jira's commands were run with, in order. */
const invoked: Array<{ id: string; args: unknown; caller: string }> = [];
client.onEvent((event) => {
  if (event.event === "connector.changed" && event.data.status)
    statuses.set(key(event.data.connector, event.data.instance), event.data.status);
  if (event.event !== "cmd.invoked" || !event.data.id.startsWith(`${JIRA}.`)) return;
  const { invocationId, id, args, caller } = event.data;
  invoked.push({ id, args: args ?? {}, caller });
  void client.call("cmd.answer", { invocationId, result: { ok: true } }, { caller: JIRA });
});

const VIEWS = { permission: "view:manage" } as const;
const ready = (async () => {
  for (const [id, title] of [
    ["example.jira.done", "Mark done"],
    ["example.jira.open", "Open in Jira"],
  ] as const)
    await client.call("cmd.register", { id, title }, { caller: JIRA });
  for (const view of [today.instance, table.instance, empty])
    await client.call("view.save", { view: view as View, scope: VIEWS });
  // example.jira brings in the fixture tasks, each with the way back to it.
  if (params.has("jira"))
    for (const item of fixtureItems().filter((i) => i.kind === "task"))
      core.upsert({
        ...item,
        source: { connector: JIRA, instance: "default" },
        deepLink: `https://jira.example.com/browse/${item.id}`,
      });
})();

const runtime = createRuntime({
  root: document.getElementById("desk") as HTMLElement,
  bridge: client,
  clock,
  storage: window.localStorage,
  platform: "other",
  plugins: { url: (id, path, revision) => `/plugins/${id}/${path}?v=${revision}` },
});

window.__desk = { clock, runtime, stub, commands: [] };
window.__views = {
  ready,
  invoked,
  upsert: (item: Item) => core.upsert(item),
  remove: (source: ItemSource, id: string) => core.remove(source, id),
};
