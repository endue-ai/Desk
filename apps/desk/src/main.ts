// Bootstrap: mount the runtime, connect it to the Rust core through the Tauri bridge, and host the
// core's UI plugins.
import { BridgeClient, tauriAdapter } from "@endue-ai/bridge";
import { createRuntime, realClock } from "@endue-ai/runtime";
import "@endue-ai/runtime/desk.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const root = document.getElementById("desk");
if (!root) throw new Error("index.html has no #desk element");

// Custom URL schemes look different on Windows (WebView2) than on macOS and Linux.
const pluginBase = navigator.userAgent.includes("Windows")
  ? "http://desk-plugin.localhost"
  : "desk-plugin://localhost";

const boot = await invoke<{ safeMode: string | null }>("desk_boot");
const bridge = new BridgeClient(tauriAdapter((command, args) => invoke(command, args), listen));
const runtime = createRuntime({
  root,
  bridge,
  clock: realClock(),
  storage: window.localStorage,
  ...(boot.safeMode ? { safeMode: boot.safeMode } : {}),
  platform: navigator.userAgent.includes("Macintosh") ? "mac" : "other",
  plugins: { url: (id, path, revision) => `${pluginBase}/${id}/${path}?v=${revision}` },
});

await runtime.ready;
await invoke("desk_ready", { status: runtime.status() });
await runtime.plugins?.ready;
