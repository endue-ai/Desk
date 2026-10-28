// Test page: the runtime with two UI plugins on the browser bridge stub. Never shipped.
import { BridgeClient, browserStub, type PluginInfo } from "@endue-ai/bridge";
import "../../src/desk.css";
import { createRuntime, ManualClock } from "../../src/index";

const root = document.getElementById("desk");
if (!root) throw new Error("no #desk element");

// plugins.html?safe starts in safe mode, with the counter built in and both plugins switched off.
const safe = new URLSearchParams(location.search).has("safe");

const info = (id: string, title: string, builtIn = false): PluginInfo => ({
  id,
  status: "ready",
  enabled: !safe,
  builtIn,
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
    plugins: [info("example.hello-ui", "Hello"), info("test.counter", "Counter", safe)],
  }),
});
const runtime = createRuntime({
  root,
  bridge: new BridgeClient(stub),
  clock,
  storage: window.localStorage,
  platform: "other",
  plugins: { url: (id, path, revision) => `/plugins/${id}/${path}?v=${revision}` },
  ...(safe ? { safeMode: "safe mode" } : {}),
});

window.__desk = { clock, runtime, stub, commands: [] };
