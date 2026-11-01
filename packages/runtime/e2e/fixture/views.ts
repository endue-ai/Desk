/// <reference types="vite/client" />
// Test page: desk.views over the desk.* policies, desk.palette and the view plugins desk.today and
// desk.item, on the core's stub with the fixture connector desk.fixtures and its items
// (packages/bridge/src/fixtures.ts). At start it saves the spec's view-today (as test.view-today:
// desk.today is the plugin's) and view-table-with-actions, fixture/views/empty.json and each view
// plugin's inline view, as the core will. It plays two test callers: example.jira provides the
// table's action commands, and test.search, a policy plugin, a palette provider ("Test results");
// both record what they get. Never shipped.
//   ?status=error   connector.list answers desk.fixtures/default in error until it syncs
//   ?jira=1         example.jira is connected too, with the fixture tasks and their deep links
//   ?empty=1        every fixture item is removed before anything opens
//   ?resources=event,message,note   desk.fixtures serves only these kinds
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
const SEARCH = "test.search";
const key = (connector: string, instance: string) => `${connector}/${instance}`;
const kinds = params.get("resources")?.split(",");

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
  const { id, resources: served, instances } = fixtureConnector();
  const resources = kinds ? served.filter((r) => kinds.includes(r.kind)) : served;
  const all = [{ id, resources, instances }, ...(params.has("jira") ? [jira] : [])];
  return all.map((c) => ({
    ...c,
    instances: c.instances.map((i) => ({
      ...i,
      status: statuses.get(key(i.connector, i.instance)) ?? i.status,
    })),
  }));
};

/** A palette provider with nothing to mount: the page answers its commands. */
const search: PluginManifest = {
  id: SEARCH,
  version: "0.1.0",
  kind: "policy",
  contributes: { paletteProviders: [{ command: `${SEARCH}.find`, title: "Test results" }] },
};
/** test.search.find's answer: two results, each recording which of its two actions ran. */
const found = {
  results: ["First", "Second"].map((title, i) => ({
    id: `result-${i + 1}`,
    title: `${title} test result`,
    detail: "test.search",
    kind: "test",
    actions: [1, 2].map((n) => ({
      command: `${SEARCH}.record`,
      title: `Record ${n}`,
      args: { n },
    })),
  })),
};

const clock = new ManualClock();
const core = browserCore({
  // The bare desk, the palette, the view engine and the view plugins: every desk.* plugin but the
  // shell's own, and the test provider.
  manifests: [
    ...Object.values(manifests).filter((m) => m.id.startsWith("desk.") && m.id !== "desk.shell"),
    search,
  ],
  handlers: { "connector.list": () => ({ connectors: listed() }) },
});
const { client, stub } = core;

/** What example.jira's commands were run with, in order; test.search's apart. */
const invoked: Array<{ id: string; args: unknown; caller: string }> = [];
const searched: Array<{ id: string; args: unknown; caller: string }> = [];
client.onEvent((event) => {
  if (event.event === "connector.changed" && event.data.status)
    statuses.set(key(event.data.connector, event.data.instance), event.data.status);
  if (event.event !== "cmd.invoked") return;
  const { invocationId, id, args, caller } = event.data;
  for (const [owner, runs] of [
    [JIRA, invoked],
    [SEARCH, searched],
  ] as const) {
    if (!id.startsWith(`${owner}.`)) continue;
    runs.push({ id, args: args ?? {}, caller });
    const result = id === `${SEARCH}.find` ? found : { ok: true };
    void client.call("cmd.answer", { invocationId, result }, { caller: owner });
  }
});

const VIEWS = { permission: "view:manage" } as const;
const ready = (async () => {
  for (const [id, title] of [
    ["example.jira.done", "Mark done"],
    ["example.jira.open", "Open in Jira"],
  ] as const)
    await client.call("cmd.register", { id, title }, { caller: JIRA });
  await client.call(
    "cmd.register",
    { id: `${SEARCH}.find`, title: "Find test results" },
    {
      caller: SEARCH,
    },
  );
  // A keyword from a fixture item's title, so the palette's query matches a command too.
  const record = { id: `${SEARCH}.record`, title: "Record a test result", keywords: ["groceries"] };
  await client.call("cmd.register", record, { caller: SEARCH });
  if (params.has("empty")) for (const item of fixtureItems()) core.remove(item.source, item.id);
  const vector = { ...today.instance, id: "test.view-today" };
  const plugins = Object.values(manifests).flatMap((m) =>
    m.kind === "view" && m.view ? [m.view] : [],
  );
  for (const view of [vector, table.instance, empty, ...plugins])
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
  search: searched,
  upsert: (item: Item) => core.upsert(item),
  remove: (source: ItemSource, id: string) => core.remove(source, id),
};
