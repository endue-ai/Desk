// Test page: the terminal plugin (plugins/terminal) over the desk.* policies on the browser stub
// (issue 319), its PTY scripted: proc.spawn starts nothing, proc.write is recorded, and the test
// prints the test pattern (terminal-pattern.ts) and more with __terminal.print.
// The shell page keeps endue.terminal for its counter (terminal-fit.spec.ts), so the plugin runs
// here as test.terminal, with its permissions and without its commands. Never shipped.
import type { BridgeEvent, PluginManifest } from "@endue-ai/bridge";
import terminalManifest from "../../../../plugins/terminal/plugin.json";
import "../../src/desk.css";
import { browserCore, memoryStore } from "../../src/bridge/core";
import { createRuntime, ManualClock } from "../../src/index";
import { PATTERN } from "./terminal-pattern";

const manifests = import.meta.glob<PluginManifest>("../../../../plugins/*/plugin.json", {
  eager: true,
  import: "default",
});
const policies = Object.values(manifests).filter(
  (m) => m.id.startsWith("desk.") && m.id !== "desk.shell" && m.kind === "policy",
);

const ID = "test.terminal";
const terminal = {
  ...(terminalManifest as PluginManifest),
  id: ID,
  contributes: {
    display: [
      { match: { plugin: ID }, area: "center", size: { columns: 1, rows: 1 }, focus: true },
    ],
  },
} as PluginManifest;

let emit: (event: BridgeEvent) => void = () => {};
const writes: Array<{ data: string; encoding: string }> = [];
let running: string | null = null;
let notices = 0;
const print = (text: string) => {
  if (running)
    emit({
      event: "proc.output",
      data: { procId: running, stream: "pty", data: text, encoding: "utf8" },
    });
};
const clock = new ManualClock();
const core = browserCore({
  manifests: [...policies, terminal],
  store: memoryStore(),
  handlers: {
    "proc.spawn": () => {
      running = "p-1";
      return { procId: running, pid: 101 };
    },
    "proc.write": ({ data, encoding = "utf8" }) => {
      writes.push({ data, encoding });
      return {};
    },
    "proc.resize": () => ({}),
    "proc.kill": () => ({}),
    // The core's ui.notify: an id, and the ui.notified event the runtime shows on the status line.
    "ui.notify": ({ title, body, level }) => {
      const notificationId = `n-${++notices}`;
      const data = { notificationId, caller: ID, title, level: level ?? "info" };
      queueMicrotask(() =>
        emit({ event: "ui.notified", data: { ...data, ...(body ? { body } : {}) } }),
      );
      return { notificationId };
    },
  },
  open: () => {},
});
emit = (event) => core.stub.emit(event);
const runtime = createRuntime({
  root: document.getElementById("desk") as HTMLElement,
  bridge: core.client,
  clock,
  platform: "other",
  plugins: { url: (id, path, revision) => `/plugins/${id}/${path}?v=${revision}` },
});

window.__desk = { clock, runtime, stub: core.stub, commands: [] };
window.__terminal = { writes, print, pattern: PATTERN };
