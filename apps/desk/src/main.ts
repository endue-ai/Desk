// Bootstrap: mount the runtime, connect it to the Rust core through the Tauri bridge, and host the
// core's UI plugins. Every frame (OS window) runs this page with its own runtime (ADR 0018).
import { BridgeClient, tauriAdapter } from "@endue-ai/bridge";
import { createRuntime, type LayoutStorage, realClock } from "@endue-ai/runtime";
import "@endue-ai/runtime/desk.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

const root = document.getElementById("desk");
if (!root) throw new Error("index.html has no #desk element");

// Custom URL schemes look different on Windows (WebView2) than on macOS and Linux.
const pluginBase = navigator.userAgent.includes("Windows")
  ? "http://desk-plugin.localhost"
  : "desk-plugin://localhost";

const frame = getCurrentWebviewWindow().label;

// Core events addressed to this frame, plus those for every frame; never another frame's.
const listenHere = (event: string, handler: (event: { payload: unknown }) => void) =>
  listen(event, handler, { target: { kind: "WebviewWindow", label: frame } });

// Each frame keeps its own layout; main keeps the key it always had.
const storage: LayoutStorage =
  frame === "main"
    ? window.localStorage
    : {
        getItem: (key) => window.localStorage.getItem(`${frame}:${key}`),
        setItem: (key, value) => window.localStorage.setItem(`${frame}:${key}`, value),
      };

const boot = await invoke<{ safeMode: string | null }>("desk_boot");
const bridge = new BridgeClient(tauriAdapter((command, args) => invoke(command, args), listenHere));
const runtime = createRuntime({
  root,
  bridge,
  clock: realClock(),
  storage,
  ...(boot.safeMode ? { safeMode: boot.safeMode } : {}),
  platform: navigator.userAgent.includes("Macintosh") ? "mac" : "other",
  plugins: { url: (id, path, revision) => `${pluginBase}/${id}/${path}?v=${revision}` },
});
runtime.shortcuts.bind("Mod+Shift+N", () => void invoke("frame_open"));

await runtime.ready;
await invoke("desk_ready", { status: runtime.status() });
await runtime.plugins?.ready;
