// Test page: a whole desk on the browser bridge stub, with the built-in sidebar (left), Eris and the
// toolbar (right), the dock (bottom) and two plugins on the grid. Manifests are read from the plugin
// folders, so the page shows what `just dev` installs. Never shipped.
//   ?broken=<id>    plugin.list reports that plugin as failed
import { BridgeClient, browserStub, type PluginInfo, type PluginManifest } from "@endue-ai/bridge";
import "../../src/desk.css";
import { createRuntime, ManualClock } from "../../src/index";

const root = document.getElementById("desk");
if (!root) throw new Error("no #desk element");
const query = new URLSearchParams(window.location.search);

// Install order, as the core installs a folder of plugins: by folder name.
const ids = [
  "endue.dock",
  "endue.eris",
  "endue.sidebar",
  "endue.toolbar",
  "example.hello-ui",
  "test.counter",
];
const manifest = async (id: string): Promise<PluginManifest> =>
  id === "test.counter"
    ? {
        id,
        name: "Counter",
        version: "0.1.0",
        kind: "ui",
        entry: "ui/index.html",
        surfaces: [{ id: "main", title: "Counter", placement: "center" }],
      }
    : ((await (await fetch(`/plugins/${id}/plugin.json`)).json()) as PluginManifest);

const plugins: PluginInfo[] = await Promise.all(
  ids.map(async (id) => ({
    id,
    status: "ready" as const,
    enabled: true,
    builtIn: id.startsWith("endue."),
    revision: 1,
    manifest: await manifest(id),
  })),
);
const broken = plugins.find((p) => p.id === query.get("broken"));
if (broken) Object.assign(broken, { status: "failed", error: "entry is missing" });

const clock = new ManualClock();
const stub = browserStub({
  "perm.query": () => ({ grants: [] }),
  "plugin.list": () => ({ plugins: structuredClone(plugins) }),
  "plugin.setEnabled": ({ plugin, enabled }) => {
    const info = plugins.find((p) => p.id === plugin);
    if (!info) throw new Error(`no plugin ${plugin}`);
    info.enabled = enabled;
    // The core answers first, then tells everyone that manages plugins.
    setTimeout(() =>
      stub.emit({
        event: "plugin.changed",
        data: { plugin, change: enabled ? "enabled" : "disabled", revision: info.revision },
      }),
    );
    return { plugin: structuredClone(info) };
  },
  "store.get": () => ({}),
  "store.set": () => ({}),
});
const runtime = createRuntime({
  root,
  bridge: new BridgeClient(stub),
  clock,
  storage: window.localStorage,
  platform: "other",
  plugins: { url: (id, path, revision) => `/plugins/${id}/${path}?v=${revision}` },
});

window.__desk = { clock, runtime, stub, commands: [] };
window.__deskPlugins = plugins;
