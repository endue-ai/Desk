// Test page: the runtime with two UI plugins, test.worker and example.hello-ui, on the browser bridge
// stub, for the plugin frames' CSP (frames.spec.ts, ADR 0048) and their per-surface origins (#36).
// `?surface=<id>` names both plugins' surface. Never shipped.
import { BridgeClient, browserStub, type PluginInfo } from "@endue-ai/bridge";
import "../../src/desk.css";
import { createRuntime, ManualClock, surfaceHost } from "../../src/index";

const root = document.getElementById("desk");
if (!root) throw new Error("no #desk element");

const surface = new URLSearchParams(location.search).get("surface") ?? "main";
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
    surfaces: [{ id: surface, title, placement: "center" }],
  },
});

// Each surface on a host of its own, as the app's scheme serves it: <surface>.<plugin label>.localhost
// on this server's port. What names no surface stays on this page's host.
const url = (id: string, path: string, revision: number, named?: string) => {
  const host = named === undefined ? undefined : surfaceHost(id, named);
  const origin = host === undefined ? "" : `http://${host}.localhost:${location.port}`;
  return `${origin}/plugins/${id}/${path}?v=${revision}`;
};

const clock = new ManualClock();
const stub = browserStub({
  "perm.query": () => ({ grants: [] }),
  "plugin.list": () => ({
    plugins: [info("test.worker", "Worker"), info("example.hello-ui", "Hello")],
  }),
});
const runtime = createRuntime({
  root,
  bridge: new BridgeClient(stub),
  clock,
  platform: "other",
  plugins: { url },
});

window.__desk = { clock, runtime, stub, commands: [] };
