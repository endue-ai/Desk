// Test page: the built-in Eris and onboarding plugins on the browser bridge stub. Never shipped.
//   ?plugins=onboarding (default) | eris | both    which plugins plugin.list returns
//   ?mic=grant (default) | deny                    how perm.request answers
//   ?name=<name>                                   a finished first run, as the core would remember it
import { BridgeClient, browserStub, type PluginInfo, type PluginManifest } from "@endue-ai/bridge";
import "../../src/desk.css";
import { createRuntime, ManualClock } from "../../src/index";

const root = document.getElementById("desk");
if (!root) throw new Error("no #desk element");
const query = new URLSearchParams(window.location.search);

const plugin = (manifest: PluginManifest): PluginInfo => ({
  id: manifest.id,
  status: "ready",
  enabled: true,
  builtIn: true,
  revision: 1,
  manifest,
});
const eris = plugin({
  id: "endue.eris",
  version: "0.1.0",
  kind: "ui",
  entry: "ui/index.html",
  surfaces: [{ id: "main", title: "Eris", placement: "right" }],
});
const onboarding = plugin({
  id: "endue.onboarding",
  version: "0.1.0",
  kind: "ui",
  entry: "ui/index.html",
  permissions: [{ permission: "audio:capture" }],
  surfaces: [{ id: "main", title: "Welcome", placement: "overlay" }],
});
const which = query.get("plugins") ?? "onboarding";
const plugins = which === "eris" ? [eris] : which === "both" ? [eris, onboarding] : [onboarding];

const store: Record<string, unknown> = {};
const name = query.get("name");
if (name) store["first-run"] = { done: true, name };
window.__deskStore = store;

const clock = new ManualClock();
const stub = browserStub({
  "perm.query": () => ({ grants: [] }),
  "plugin.list": () => ({ plugins }),
  "perm.request": () => ({ granted: query.get("mic") !== "deny" }),
  "store.get": ({ key }) => (key in store ? { value: store[key] } : {}),
  "store.set": ({ key, value }) => {
    store[key] = value;
    return {};
  },
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
