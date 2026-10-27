// Bootstrap: mount the runtime and connect it to the Rust core through the Tauri bridge.
import { BridgeClient, tauriAdapter } from "@endue-ai/bridge";
import { createRuntime, realClock } from "@endue-ai/runtime";
import "@endue-ai/runtime/desk.css";
import { invoke } from "@tauri-apps/api/core";

const root = document.getElementById("desk");
if (!root) throw new Error("index.html has no #desk element");

// Core events (and the event permissions they need) arrive with the first event source.
const bridge = new BridgeClient(tauriAdapter((command, args) => invoke(command, args)));
const runtime = createRuntime({
  root,
  bridge,
  clock: realClock(),
  storage: window.localStorage,
  platform: navigator.userAgent.includes("Macintosh") ? "mac" : "other",
});

await runtime.ready;
await invoke("desk_ready", { status: runtime.status() });
