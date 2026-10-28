/// <reference types="vite/client" />
// Test page: the runtime with the built-in desk.* policy plugins (their real plugin.json files) and a
// test UI plugin, on the browser bridge stub. Never shipped.
//   ?init={"desk.theme.scheme":"light"}  init.yaml settings    ?off=desk.keys,desk.theme  disabled
//   ?platform=mac                        the keymap's platform  ?profile=focus             start profile
//   ?rules=[{"match":{...},"area":...}]  display rules test.echo contributes
import { BridgeClient, browserStub, type PluginInfo, type PluginManifest } from "@endue-ai/bridge";
import "../../src/desk.css";
import { createRuntime, ManualClock } from "../../src/index";

const params = new URLSearchParams(location.search);
const off = new Set((params.get("off") ?? "").split(",").filter(Boolean));
const manifests = import.meta.glob<PluginManifest>("../../../../plugins/*/plugin.json", {
  eager: true,
  import: "default",
});
const echo: PluginManifest = {
  id: "test.echo",
  version: "0.1.0",
  kind: "ui",
  entry: "ui/index.html",
  permissions: [{ permission: "ui:notify" }],
  surfaces: [{ id: "main", title: "Echo", placement: "center" }],
  contributes: {
    commands: [{ id: "test.echo.say", title: "Say it back" }],
    display: JSON.parse(params.get("rules") ?? "[]"),
  },
};
const counter: PluginManifest = {
  id: "test.counter",
  version: "0.1.0",
  kind: "ui",
  entry: "ui/index.html",
  surfaces: [{ id: "main", title: "Counter", placement: "center" }],
};
const plugins: PluginInfo[] = [
  ...Object.values(manifests).filter((m) => m.id.startsWith("desk.")),
  echo,
  counter,
].map((manifest) => ({
  id: manifest.id,
  status: "ready",
  enabled: !off.has(manifest.id),
  builtIn: manifest.id.startsWith("desk."),
  revision: 1,
  manifest,
}));

let notices = 0;
const clock = new ManualClock();
const stub = browserStub({
  "perm.query": () => ({ grants: [] }),
  "plugin.list": () => ({ plugins: structuredClone(plugins) }),
  "plugin.setEnabled": ({ plugin, enabled }) => {
    const info = plugins.find((p) => p.id === plugin);
    if (!info) throw new Error(`no plugin ${plugin}`);
    info.enabled = enabled;
    queueMicrotask(() =>
      stub.emit({
        event: "plugin.changed",
        data: { plugin, change: enabled ? "enabled" : "disabled", revision: info.revision },
      }),
    );
    return { plugin: structuredClone(info) };
  },
  "init.get": () => ({
    profile: params.get("profile") ?? "default",
    settings: JSON.parse(params.get("init") ?? "{}"),
  }),
  // The core's ui.notify: an id, and the ui.notified event the runtime shows.
  "ui.notify": ({ title, body, level }) => {
    const notificationId = `n-${++notices}`;
    queueMicrotask(() =>
      stub.emit({
        event: "ui.notified",
        data: {
          notificationId,
          caller: "test.echo",
          title,
          level: level ?? "info",
          ...(body ? { body } : {}),
        },
      }),
    );
    return { notificationId };
  },
});
const runtime = createRuntime({
  root: document.getElementById("desk") as HTMLElement,
  bridge: new BridgeClient(stub),
  clock,
  storage: window.localStorage,
  platform: params.get("platform") === "mac" ? "mac" : "other",
  plugins: { url: (id, path, revision) => `/plugins/${id}/${path}?v=${revision}` },
});

window.__desk = { clock, runtime, stub, commands: [] };
