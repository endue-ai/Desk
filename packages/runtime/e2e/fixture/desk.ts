/// <reference types="vite/client" />
// Test page: the runtime with the built-in desk.* policy plugins (their real plugin.json files) and a
// test UI plugin, on the browser bridge stub. Never shipped.
//   ?init={"desk.theme.scheme":"light"}  init.yaml settings    ?off=desk.keys,desk.theme  disabled
//   ?platform=mac                        the keymap's platform  ?profile=focus             start profile
//   ?rules=[{"match":{...},"area":...}]  display rules test.echo contributes
//   ?store={"session":{...}}             what the core's store holds for the runtime at start
import type { PluginManifest } from "@endue-ai/bridge";
import "../../src/desk.css";
import { browserCore, memoryStore } from "../../src/bridge/core";
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
  permissions: [
    { permission: "ui:notify" },
    { permission: "fs:write", paths: ["~/**"] },
    { permission: "cmd:invoke", ids: ["desk.*"] },
  ],
  surfaces: [{ id: "main", title: "Echo", placement: "center" }],
  contributes: {
    commands: [{ id: "test.echo.say", title: "Say it back" }],
    display: JSON.parse(params.get("rules") ?? "[]"),
    files: [{ pattern: "*.txt", plugin: "test.echo" }],
  },
};
const counter: PluginManifest = {
  id: "test.counter",
  version: "0.1.0",
  kind: "ui",
  entry: "ui/index.html",
  surfaces: [{ id: "main", title: "Counter", placement: "center" }],
};
let notices = 0;
// The core's store (per caller) and the files plugins wrote, kept in memory for the tests.
const store: Record<string, unknown> = JSON.parse(params.get("store") ?? "{}");
const written: Array<{ path: string; content: string }> = [];
const clock = new ManualClock();
const { client, stub } = browserCore({
  // The bare desk: every desk.* policy but the shell's own (views.html has the view engine and the
  // view plugins).
  manifests: [
    ...Object.values(manifests).filter(
      (m) =>
        m.id.startsWith("desk.") &&
        m.id !== "desk.shell" &&
        m.id !== "desk.views" &&
        m.kind !== "view",
    ),
    echo,
    counter,
  ],
  off,
  store: memoryStore(store),
  init: {
    profile: params.get("profile") ?? "default",
    settings: JSON.parse(params.get("init") ?? "{}"),
  },
  handlers: {
    "fs.write": ({ path, content }) => {
      written.push({ path, content });
      return { bytesWritten: content.length };
    },
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
  },
});
const runtime = createRuntime({
  root: document.getElementById("desk") as HTMLElement,
  bridge: client,
  clock,
  storage: window.localStorage,
  platform: params.get("platform") === "mac" ? "mac" : "other",
  plugins: { url: (id, path, revision) => `/plugins/${id}/${path}?v=${revision}` },
});

window.__desk = { clock, runtime, stub, commands: [] };
window.__deskStore = store;
window.__deskWritten = written;
