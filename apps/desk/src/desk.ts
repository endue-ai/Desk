// Bootstrap: mount the desk shell on the Rust core through the Tauri bridge. The runtime under it
// hosts the core's UI plugins; the shell reaches the brain and its agent directory through the core.
import { BridgeClient, tauriAdapter } from "@endue-ai/bridge";
import { mountDesk, realClock } from "@endue-ai/runtime";
import "@endue-ai/runtime/desk.css";
import "@endue-ai/runtime/shell.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { installNativeFileDrops, pickNativeFile } from "./native-files";
import { installOpenedFiles } from "./open-files";
import { shellBridge } from "./shell-bridge";

const root = document.getElementById("desk");
if (!root) throw new Error("index.html has no #desk element");

// Custom URL schemes look different on Windows (WebView2) than on macOS and Linux.
const pluginBase = navigator.userAgent.includes("Windows")
  ? "http://desk-plugin.localhost"
  : "desk-plugin://localhost";

const core = new BridgeClient(tauriAdapter((command, args) => invoke(command, args), listen));
const desk = mountDesk({
  root,
  bridge: shellBridge(core),
  core,
  plugins: { url: (id, path, revision) => `${pluginBase}/${id}/${path}?v=${revision}` },
  clock: realClock(),
  platform: navigator.userAgent.includes("Macintosh") ? "mac" : "other",
  lang: navigator.language.startsWith("ko") ? "ko" : "en",
  pickFile: pickNativeFile,
  onSurfaceShown: (id) => {
    if (id === "desk.palette") void invoke("palette_reveal_main");
  },
});

const disposeDrops = installNativeFileDrops({
  ready: desk.ready,
  commands: desk.runtime.commands,
  report: (error) =>
    desk.runtime.notify({
      caller: "desk",
      title: "Could not open the dropped file",
      body: error instanceof Error ? error.message : String(error),
      level: "error",
    }),
});
window.addEventListener("pagehide", disposeDrops, { once: true });

const disposeOpened = installOpenedFiles({
  ready: desk.ready,
  commands: desk.runtime.commands,
  report: (error) =>
    desk.runtime.notify({
      caller: "desk",
      title: "Could not open the associated file",
      body: error instanceof Error ? error.message : String(error),
      level: "error",
    }),
});
window.addEventListener("pagehide", disposeOpened, { once: true });

await desk.ready;
await invoke("desk_ready", { status: desk.runtime.status() });
