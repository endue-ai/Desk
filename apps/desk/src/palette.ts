// A small host for the same palette UI. The main runtime alone owns the plugin command registry.
// Both shells give this window the fixed caller `palette` and answer its `palette_*` commands.
import type { BridgeEvent, BridgeRequest, BridgeResponse } from "@endue-ai/bridge";
import { invoke, listen, shell } from "./host";
import "./palette.css";
import { followDeskTheme } from "./palette-theme";

const root = document.getElementById("desk");
if (!root) throw new Error("No palette root");
const frame = document.createElement("iframe");
frame.title = "Search Desk";
frame.setAttribute("sandbox", "allow-scripts");
// WebView2 reaches custom schemes as http://<scheme>.localhost; the CEF shell serves desk-plugin://.
const base =
  shell === "tauri" && navigator.userAgent.includes("Windows")
    ? "http://desk-plugin.localhost"
    : "desk-plugin://localhost";
let ready = false;
let presented = false;
let pendingOpen = true;
const post = (message: unknown) => frame.contentWindow?.postMessage(message, "*");
const open = () => {
  if (!ready) {
    pendingOpen = true;
    return;
  }
  post({ type: "desk:command", name: "desk.palette.open" });
  frame.focus();
};
// Register listeners before loading the frame, including before its first command invocation.
// The theme the main window keeps styles this window's root now and its frame from desk:hello on.
const theme = followDeskTheme({ root: document.documentElement, post });
await listen("palette://open", () => {
  presented = true;
  theme.refresh();
  open();
});
await listen<BridgeEvent>("bridge://event", ({ payload: event }) => {
  if (event.event === "cmd.answered" && event.data.caller === "palette") {
    post({ type: "desk:event", event });
  }
});
window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== frame.contentWindow) return;
  const message = event.data;
  if (message?.type === "desk:hello") {
    ready = true;
    post({ type: "desk:init", pluginId: "palette" });
    theme.hello();
    if (pendingOpen) {
      pendingOpen = false;
      open();
    }
  } else if (message?.type === "desk:palette-command") {
    // A command may open the shared picker in the main runtime. Reveal it without stealing focus.
    void invoke("palette_prepare_main");
  } else if (message?.type === "desk:palette-activated") {
    void invoke("palette_reveal_main");
  } else if (message?.type === "desk:visible") {
    if (message.visible === false) void invoke("palette_hide");
    else if (presented) void invoke("palette_present");
  } else if (message?.type === "desk:calls" && Array.isArray(message.calls)) {
    void Promise.all(
      message.calls.map(async (request: BridgeRequest) => {
        try {
          const response = await invoke<BridgeResponse>("bridge_call", { request });
          return { id: request.id, response };
        } catch (error) {
          return {
            id: request.id,
            response: {
              id: request.id,
              ok: false,
              error: { code: "internal", message: String(error) },
            },
          };
        }
      }),
    ).then((results) => post({ type: "desk:results", results }));
  }
});
frame.src = `${base}/_desk/palette/index.html?native=1`;
root.replaceChildren(frame);
