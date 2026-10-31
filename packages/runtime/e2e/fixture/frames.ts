// Test page: the runtime with one UI plugin, test.worker, on the browser bridge stub, for the plugin
// frames' CSP (frames.spec.ts, ADR 0048). Never shipped.
import { BridgeClient, browserStub, type PluginInfo } from "@endue-ai/bridge";
import "../../src/desk.css";
import { createRuntime, ManualClock } from "../../src/index";

const root = document.getElementById("desk");
if (!root) throw new Error("no #desk element");

const info = (id: string, title: string): PluginInfo => ({
  id,
  status: "ready",
  enabled: true,
  builtIn: false,
  revision: 1,
  manifest: {
    id,
    version: "0.1.0",
    kind: "ui",
    entry: "ui/index.html",
    surfaces: [{ id: "main", title, placement: "center" }],
  },
});

const clock = new ManualClock();
const stub = browserStub({
  "perm.query": () => ({ grants: [] }),
  "plugin.list": () => ({
    plugins: [info("test.worker", "Worker")],
  }),
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
