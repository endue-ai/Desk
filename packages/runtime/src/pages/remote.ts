/**
 * Surface pages in browsers of their own (ADR 0160): the app's compositor draws each plugin surface
 * from its own process, and the shell carries the plugin host's messages (`desk:init`, `desk:state`,
 * the theme, pings) between this page and each surface's page, keyed by the surface's host
 * (`<surface>.<plugin label>`, #36), which only that surface's page has. No frame stands in for it:
 * the section holds the surface's place (`place.ts`), which keeps its spot in the page's focus order.
 * Each surface has one port, the `Window` the plugin host posts to and hears its messages from (ADR
 * 0012: a plugin is told apart by it, so it only ever calls as itself); a surface loaded again after
 * an unload gets a new one, as a frame put back gets a new window. Messages travel as JSON.
 */
import { surfaceHost } from "../plugin-origins";
import type { SurfaceSpec } from "../surfaces";
import { makePlace, type Place } from "./place";
import type { SurfacePages } from "./types";

/** The shell's side: what goes to a surface's page, and what its page sends. */
export interface SurfaceTransport {
  /** Send `text` (one message as JSON) to the page of the surface on host `host`. */
  post(host: string, text: string): void;
  /** Hear each surface's page post to the desk; returns the function that stops. */
  listen(receive: (host: string, text: string) => void): () => void;
}

/** One surface's page as the compositor's report names it. */
export interface RemoteSurface {
  /** The plugin's id, which the runtime's section is named after. */
  id: string;
  host: string;
  /** The document its page shows. */
  src: string;
  /** How many times its page was loaded: a new revision, or back after an unload or a death. */
  loads: number;
  /** The surface's place in its section; out of the page while the surface is unloaded. */
  view: HTMLElement;
  /** Unloaded: its page has gone until it is back (ADR 0070). */
  away: boolean;
}

export interface RemotePages extends SurfacePages {
  /** Every surface the desk shows, in the order they opened. */
  list(): RemoteSurface[];
  /** Stop hearing the shell. */
  dispose(): void;
}

/** The plugin surface host of a page's URL, `<surface>.<plugin label>`, if it names one. */
export function surfaceHostOf(src: string): string | undefined {
  const match = /^desk-plugin:\/\/([^/?#:]+)/.exec(src);
  const host = match?.[1];
  return host && host !== "localhost" && host.includes(".") ? host : undefined;
}

interface Kept extends RemoteSurface {
  port: Window;
  place: Place;
}

export function remotePages(win: Window, transport: SurfaceTransport): RemotePages {
  const kept = new Map<string, Kept>();
  const byHost = new Map<string, Kept>();
  const port = (host: string): Window =>
    ({
      postMessage(message: unknown) {
        let text: string | undefined;
        try {
          text = JSON.stringify(message);
        } catch {
          return;
        }
        if (typeof text === "string") transport.post(host, text);
      },
    }) as unknown as Window;
  const receive = (host: string, text: string) => {
    const surface = byHost.get(host);
    if (!surface || surface.away) return;
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return;
    }
    // Its page tabbed past an end (#123): the page's own focus order goes on from its place.
    const type = (data as { type?: unknown } | null)?.type;
    if (type === "desk:surface-leave") {
      surface.place.leave((data as { next?: unknown }).next !== false);
      return;
    }
    const event = new MessageEvent("message", { data, origin: `desk-plugin://${host}` });
    Object.defineProperty(event, "source", { value: surface.port });
    win.dispatchEvent(event);
  };
  const stop = transport.listen(receive);
  return {
    make(spec: SurfaceSpec, doc: Document) {
      const src = spec.src ?? "";
      // The host its URL names in the app; a page served from elsewhere (a fixture's) has the same.
      const host = surfaceHostOf(src) ?? surfaceHost(spec.id, spec.surface) ?? "";
      const tell = (text: string) => host && transport.post(host, text);
      const place = makePlace(doc, spec.title, host, tell);
      const surface: Kept = {
        id: spec.id,
        host,
        src,
        loads: 1,
        view: place.element,
        away: false,
        port: port(host),
        place,
      };
      kept.set(spec.id, surface);
      if (host) byHost.set(host, surface);
      return place.element;
    },
    load(id, _view, src) {
      const surface = kept.get(id);
      if (!surface) return;
      surface.src = src;
      if (!surface.away) surface.loads += 1;
    },
    port: (id) => {
      const surface = kept.get(id);
      return surface && !surface.away ? surface.port : null;
    },
    back(id, view, focused) {
      const surface = kept.get(id);
      if (!surface) return;
      surface.away = false;
      surface.loads += 1;
      surface.port = port(surface.host);
      if (focused) view.focus();
    },
    away(id) {
      const surface = kept.get(id);
      if (surface) surface.away = true;
    },
    // The page takes no focus back: a surface's own page focusing itself moves nothing here.
    focusin: () => false,
    // The desk gave the surface the focus (Ctrl+Tab, a window shown, a file opened, a question):
    // its place takes the page's focus, so the compositor gives the surface the keys and a Tab past
    // its page's end goes on from there (ADR XXXX). Its section alone kept them on this page.
    focused: (id) => {
      const surface = kept.get(id);
      if (surface && !surface.away && surface.view.isConnected)
        surface.view.focus({ preventScroll: true });
    },
    close(id) {
      const surface = kept.get(id);
      kept.delete(id);
      if (surface && byHost.get(surface.host) === surface) byHost.delete(surface.host);
    },
    list: () => [...kept.values()].map(({ port: _p, place: _q, ...rest }) => rest),
    dispose: () => stop(),
  };
}
