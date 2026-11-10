// Test page: the runtime as the desk's system surface (ADR 0160), the way the app runs it. Its plugin
// surfaces' pages are not frames of the runtime's page (`#desk`): the runtime keeps only each
// surface's place there, and this page plays the CEF shell and the compositor, showing each surface's
// page in a frame of its own layer (`#surfaces`) over its place and carrying the plugin host's
// messages to and from it by the surface's host (`remotePages`). Never shipped.
import type { PluginManifest } from "@endue-ai/bridge";
import "../../src/desk.css";
import { browserCore, memoryStore } from "../../src/bridge/core";
import {
  createRuntime,
  ManualClock,
  type RemotePages,
  remotePages,
  type SurfaceTransport,
} from "../../src/index";

const ui = (id: string, title: string): PluginManifest => ({
  id,
  version: "0.1.0",
  kind: "ui",
  entry: "ui/index.html",
  surfaces: [{ id: "main", title, placement: "center" }],
});

/** The shell's side: each surface's page as a frame of the layer, by host. */
const layer = document.getElementById("surfaces") as HTMLElement;
const frames = new Map<string, { frame: HTMLIFrameElement; loads: number }>();
/** What the runtime posted to each surface, and what each posted up, in order. */
const posted: Array<{ host: string; type: unknown; to: "page" | "desk" }> = [];
let receive: (host: string, text: string) => void = () => {};
const transport: SurfaceTransport = {
  post(host, text) {
    const data = JSON.parse(text) as { type?: unknown };
    posted.push({ host, type: data.type, to: "page" });
    frames.get(host)?.frame.contentWindow?.postMessage(data, "*");
  },
  listen(r) {
    receive = r;
    return () => {
      receive = () => {};
    };
  },
};
addEventListener("message", (event) => {
  for (const [host, { frame }] of frames) {
    if (frame.contentWindow !== event.source) continue;
    posted.push({ host, type: (event.data as { type?: unknown } | null)?.type, to: "desk" });
    receive(host, JSON.stringify(event.data));
    return;
  }
});

/** The compositor's look, each frame: a page per surface, at its place, loaded as often as it was. */
function compose(pages: RemotePages): void {
  const seen = new Set<string>();
  for (const s of pages.list()) {
    if (!s.host || s.away) continue;
    seen.add(s.host);
    let kept = frames.get(s.host);
    if (!kept) {
      const frame = document.createElement("iframe");
      frame.setAttribute("sandbox", "allow-scripts");
      frame.dataset.host = s.host;
      layer.append(frame);
      kept = { frame, loads: 0 };
      frames.set(s.host, kept);
    }
    if (kept.loads !== s.loads) {
      kept.loads = s.loads;
      kept.frame.src = s.src;
    }
    const r = s.view.getBoundingClientRect();
    const shown = s.view.isConnected && !s.view.closest("[hidden]") && r.width > 0;
    Object.assign(kept.frame.style, {
      display: shown ? "block" : "none",
      left: `${r.x}px`,
      top: `${r.y}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
  }
  for (const [host, { frame }] of frames) {
    if (seen.has(host)) continue;
    frame.remove();
    frames.delete(host);
  }
}

const clock = new ManualClock();
const { client, stub } = browserCore({
  manifests: [ui("test.echo", "Echo"), ui("test.counter", "Counter")],
  store: memoryStore({}),
});
const pages = remotePages(window, transport);
const runtime = createRuntime({
  root: document.getElementById("desk") as HTMLElement,
  bridge: client,
  clock,
  pages,
  plugins: { url: (id, path, revision) => `/plugins/${id}/${path}?v=${revision}` },
});
const look = () => {
  compose(pages);
  requestAnimationFrame(look);
};
requestAnimationFrame(look);

window.__desk = { clock, runtime, stub, commands: [] };
window.__system = { posted, pages };
