// Bootstrap: mount the desk shell on the Rust core through the CEF shell's bridge. The runtime
// under it hosts the core's UI plugins; the shell reaches the brain and its agent directory through
// the core.
import { BridgeClient } from "@endue-ai/bridge";
import {
  deskPluginUrl,
  mountDesk,
  type Published,
  phase,
  realClock,
  remotePages,
} from "@endue-ai/runtime";
import "@endue-ai/runtime/desk.css";
import "@endue-ai/runtime/shell.css";
import { startCompositorDesk } from "./compositor-desk";
import { startCompositorFocus } from "./compositor-focus";
import { startCompositorKeys } from "./compositor-keys";
import { shellSurfaces } from "./compositor-surfaces";
import { cardCommand, type HeldPayload, type RunPayload, wmSeam } from "./compositor-wm";
import "./compositor.css";
import { reportCrashes, showLastCrash } from "./crashes";
import "./crashes.css";
import { adapter, invoke, listen } from "./host";
import { pickNativeFile, realNativePath } from "./native-files";
import { installOpenedFiles } from "./open-files";
import { sendThemeToPalette } from "./palette-theme";
import { installQuit } from "./quit";
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

// The CEF shell serves `desk-plugin://` on every OS. Each plugin surface loads on a host of its
// own (#36).
const pluginUrl = deskPluginUrl(false);

const core = new BridgeClient(adapter());
// Safe mode and the state files kept broken (ADR 0061), known before the shell mounts.
const start = await readStart(invoke);
const lang = navigator.language.startsWith("ko") ? "ko" : "en";
// The CEF shell's compositor draws the windows from desk-wm, which holds them, drags, resizes,
// snaps and pans them on the compositor's input and keeps the live budget (#52, #81, #80, #83); it
// is the only desk.
const seam = wmSeam(
  (command, args) => void invoke(command, args).catch(() => undefined),
  (command, args) => invoke(command, args),
);
// Every plugin surface's page is a browser of its own the compositor draws (ADR 0160): the runtime
// keeps only its place here, and the shell carries the plugin host's messages to it and back.
const pages = remotePages(window, shellSurfaces());
const desk = mountDesk({
  windowManager: seam.host,
  pages,
  root,
  bridge: shellBridge(core),
  core,
  // Native plugins draw only through the compositor (#59), which is the desk (#83).
  plugins: { url: pluginUrl, native: true },
  clock: realClock(),
  platform: navigator.userAgent.includes("Macintosh") ? "mac" : "other",
  lang,
  pickFile: pickNativeFile,
  realPath: realNativePath,
  start,
  relaunch: relauncher(invoke),
  onSurfaceShown: (id) => {
    if (id === "desk.palette") void invoke("palette_reveal_main");
  },
});
void desk.runtime.ready.then(() => phase("desk mount", booted));

// Files opened from the OS (the command line, Finder, the Dock) and files dragged in from it and
// dropped where no plugin takes them (the compositor's broker, #56): one queue, drained in order.
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

// The person quits (the menu, the tray, the Dock, an update's restart): unsaved changes are asked
// about here first, and the shell quits on the answer (#163).
const disposeQuit = installQuit({
  buffers: desk.runtime.buffers,
  listen: (event, handler) => listen(event, handler),
  answer: (answer) => invoke("desk_quit", { answer }),
  report: (error) =>
    desk.runtime.notify({
      caller: "desk",
      title: "The desk did not quit",
      body: error instanceof Error ? error.message : String(error),
      level: "error",
    }),
});
window.addEventListener("pagehide", disposeQuit, { once: true });

// The page reports what only it knows (ADR 0151); the CEF shell answers with the windows that keep
// a live frame, which the runtime carries out, and with each desk desk-wm publishes, which the
// runtime takes whole (ADR 0153, #83). Its input (#56) decides by the keymap whose a key is, and
// follows the focus this page moves.
const stopDesk = startCompositorDesk(
  window,
  desk,
  pages,
  (report) => {
    void invoke("compositor_desk", report as unknown as Record<string, unknown>);
  },
  seam.state,
);
// What the compositor says changes what the page reports: it looks on every frame again (ADR 0164).
const offLive = listen<{ live?: string[] }>("desk://compositor-live", ({ payload }) => {
  if (Array.isArray(payload?.live)) seam.live(payload.live);
  stopDesk.wake();
});
const offWm = listen<Published>("desk://compositor-wm", ({ payload }) => {
  if (payload && typeof payload.rev === "number" && payload.desk) seam.took(payload);
  stopDesk.wake();
});
const offHeld = listen<HeldPayload>("desk://compositor-held", ({ payload }) => {
  if (payload) seam.held(payload, desk);
  stopDesk.wake();
});
const offRun = listen<RunPayload>("desk://compositor-run", ({ payload }) => {
  const run = payload && cardCommand(payload);
  if (run) void desk.runtime.commands.run(run.command, run.args).catch(() => undefined);
});
// The person folded the canvas map the compositor draws, or opened it: the session keeps that.
const offMap = listen<{ folded?: unknown }>("desk://compositor-map", ({ payload }) => {
  if (typeof payload?.folded === "boolean") desk.store.set({ mapFolded: payload.folded });
  stopDesk.wake();
});
const keys = {
  platform: desk.runtime.shortcuts.platform,
  keymap: desk.runtime.keymap,
  commands: desk.runtime.commands,
  settings: desk.runtime.settings,
};
const stopKeys = startCompositorKeys(keys, (report) => {
  void invoke("compositor_keys", report as unknown as Record<string, unknown>);
});
const focus = startCompositorFocus(window, ({ surface, own }, answer) => {
  void invoke("compositor_focus", { surface, own, answer });
});
// What is typed after a key the desk runs waits until the page says where it left the keys.
const offRuns = desk.runtime.keymap.onRun((done) => focus.ran(done));
const stopCompositor = () => {
  for (const off of [stopDesk, stopKeys, offRuns, focus.stop, () => pages.dispose()]) off();
  for (const listening of [offLive, offWm, offHeld, offRun, offMap])
    void listening.then((off) => off());
};
window.addEventListener("pagehide", stopCompositor, { once: true });

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
