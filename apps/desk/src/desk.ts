// Bootstrap: mount the desk shell on the Rust core through the Tauri bridge. The runtime under it
// hosts the core's UI plugins; the shell reaches the brain and its agent directory through the core.
import { BridgeClient } from "@endue-ai/bridge";
import { deskPluginUrl, mountDesk, phase, realClock } from "@endue-ai/runtime";
import "@endue-ai/runtime/desk.css";
import "@endue-ai/runtime/shell.css";
import { reportCrashes, showLastCrash } from "./crashes";
import "./crashes.css";
import { adapter, invoke, listen, shell } from "./host";
import { installNativeFileDrops, pickNativeFile } from "./native-files";
import { installOpenedFiles } from "./open-files";
import { sendThemeToPalette } from "./palette-theme";
import { shellBridge } from "./shell-bridge";
import { readStart, relauncher } from "./start";
import { nextPaint, reportStartup } from "./startup";
import { installUpdates, NOTIFIED, ROW } from "./updates";

// The shell window's uncaught errors become local crash reports from here on (#322).
const stopCrashReports = reportCrashes(window, (command, args) => invoke(command, args));
window.addEventListener("pagehide", stopCrashReports, { once: true });

// Start-up phases for the app's trace (DESK_TRACE=1): from the page's time origin to this code.
const booted = performance.now();
phase("webview load", 0, booted);

const root = document.getElementById("desk");
if (!root) throw new Error("index.html has no #desk element");

// Custom URL schemes look different on Windows' WebView2 than on macOS and Linux; the CEF shell
// serves `desk-plugin://` on every OS. Each plugin surface loads on a host of its own (#36).
const pluginUrl = deskPluginUrl(shell === "tauri" && navigator.userAgent.includes("Windows"));

const core = new BridgeClient(adapter());
// Safe mode and the state files kept broken (ADR 0061), known before the shell mounts.
const start = await readStart(invoke);
const lang = navigator.language.startsWith("ko") ? "ko" : "en";
const desk = mountDesk({
  root,
  bridge: shellBridge(core),
  core,
  plugins: { url: pluginUrl },
  clock: realClock(),
  platform: navigator.userAgent.includes("Macintosh") ? "mac" : "other",
  lang,
  // The CEF shell's native file picker arrives with its dialogs (#45).
  ...(shell === "tauri" ? { pickFile: pickNativeFile } : {}),
  start,
  relaunch: relauncher(invoke),
  onSurfaceShown: (id) => {
    if (id === "desk.palette") void invoke("palette_reveal_main");
  },
});
void desk.runtime.ready.then(() => phase("desk mount", booted));

// Native file drops hand over paths through Tauri's window; the CEF shell's arrive with #45.
const disposeDrops =
  shell !== "tauri"
    ? () => {}
    : installNativeFileDrops({
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

// A plugin frame whose renderer died (#44): the CEF shell names it, and the window recovers by itself.
const offCrashes = listen<{ plugin?: string }>("desk://frame-crashed", ({ payload }) => {
  if (typeof payload?.plugin === "string") desk.runtime.frames.crashed(payload.plugin);
});
window.addEventListener("pagehide", () => void offCrashes.then((off) => off()), { once: true });

// The desk's own updates: a row in the rail's attention list and the desk.update.* commands.
const disposeUpdates = installUpdates({
  core,
  ready: desk.ready,
  lang,
  show: (row) =>
    desk.store.set((s) => ({
      attention: [...s.attention.filter((a) => a.id !== ROW), ...(row ? [row] : [])],
    })),
  commands: desk.runtime.commands,
  notify: (input) => desk.runtime.notify(input),
  memory: {
    get: () => localStorage.getItem(NOTIFIED),
    set: (version) => localStorage.setItem(NOTIFIED, version),
  },
});
window.addEventListener("pagehide", disposeUpdates, { once: true });

await desk.ready;
const ready = performance.now();
const painted = nextPaint();
// The native palette window has no runtime of its own: it follows the theme in force here (TH-08).
const disposePaletteTheme = sendThemeToPalette(desk.runtime);
window.addEventListener("pagehide", disposePaletteTheme, { once: true });
// The ready line; the answer says whether the app keeps a start-up trace to report to.
const tracing = await invoke<boolean>("desk_ready", { status: desk.runtime.status() });
// Last time's crash, once: a card with the report, kept on this computer (#322).
void showLastCrash(
  document.body,
  (command, args) => invoke(command, args),
  (text) => navigator.clipboard.writeText(text),
);
void reportStartup({
  tracing,
  ready,
  painted,
  send: (phases) => invoke("desk_trace", { origin: performance.timeOrigin, phases }),
});
