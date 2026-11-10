/**
 * Surface pages in frames of the desk's own page, for a desk without the compositor (the runtime's
 * tests, its fixture pages, the dev page; ADR 0160). Frames get `allow-scripts` only: no same-origin
 * access to the desk, no top navigation, no forms or popups (ADR 0012). A frame loading again (an
 * unload put back, a saved session's window) may not take the focus while it settles (`settle.ts`).
 */
import { Settling } from "../frames/settle";
import type { SurfaceSpec } from "../surfaces";
import type { SurfacePages } from "./types";

const frameOf = (view: HTMLElement) =>
  view instanceof HTMLIFrameElement ? view : view.querySelector("iframe");

export function framePages(): SurfacePages {
  const settling = new Settling();
  return {
    make(spec: SurfaceSpec, doc: Document, returning: boolean) {
      const frame = doc.createElement("iframe");
      frame.className = "desk-surface-frame";
      frame.title = spec.title;
      frame.setAttribute("sandbox", "allow-scripts");
      if (spec.srcdoc !== undefined) frame.srcdoc = spec.srcdoc;
      else if (spec.src !== undefined) frame.src = spec.src;
      if (returning) settling.start(spec.id, frame);
      return frame;
    },
    load(_id, view, src) {
      const frame = frameOf(view);
      if (frame) frame.src = src;
    },
    port: (_id, view) => frameOf(view)?.contentWindow ?? null,
    back(id, view, focused) {
      const frame = frameOf(view);
      if (!frame) return;
      if (focused) frame.focus();
      else settling.start(id, frame);
    },
    away: () => {},
    focusin(id, event, section) {
      // The desk focusing the surface itself ends a frame's settling; the frame taking it does not.
      if (event.target === section) settling.forget(id);
      else return settling.refocus(id, section.ownerDocument);
      return false;
    },
    focused(id, section) {
      settling.forget(id);
      settling.moved(section);
    },
    close: (id) => settling.forget(id),
  };
}
