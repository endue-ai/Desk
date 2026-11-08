// Where plugin frames sit on the desk's page, for the drag broker: which frame is on top at a point,
// and points between the page and a frame (its border and any scale the shell applies included).
import type { Point } from "./types";

/** The desk's own drag layer, which hit tests look through. */
export const LAYER_ATTRIBUTE = "data-desk-dnd";

interface Place {
  x: number;
  y: number;
  sx: number;
  sy: number;
}

export function frameGeometry(
  doc: Document,
  frame: (id: string) => Window | null,
  mounted: () => string[],
) {
  const pluginOf = (element: Element) => {
    if (element.tagName !== "IFRAME") return undefined;
    const win = (element as HTMLIFrameElement).contentWindow;
    return win ? mounted().find((id) => frame(id) === win) : undefined;
  };
  const elementOf = (id: string) => {
    const win = frame(id);
    if (!win) return undefined;
    return [...doc.querySelectorAll("iframe")].find((element) => element.contentWindow === win);
  };
  /** The frame's content box on the page, and how much the page scales it. */
  const placeOf = (id: string): Place | undefined => {
    const element = elementOf(id);
    if (!element?.isConnected) return undefined;
    const box = element.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) return undefined;
    const sx = element.offsetWidth > 0 ? box.width / element.offsetWidth : 1;
    const sy = element.offsetHeight > 0 ? box.height / element.offsetHeight : 1;
    return { x: box.left + element.clientLeft * sx, y: box.top + element.clientTop * sy, sx, sy };
  };
  return {
    /** The plugin whose frame is the topmost thing at the point; desk chrome above it hides it. */
    pluginAt(x: number, y: number): string | undefined {
      for (const element of doc.elementsFromPoint(x, y)) {
        if (element.closest(`[${LAYER_ATTRIBUTE}]`)) continue;
        return pluginOf(element);
      }
      return undefined;
    },
    toFrame(id: string, at: Point): Point | undefined {
      const place = placeOf(id);
      return place && { x: (at.x - place.x) / place.sx, y: (at.y - place.y) / place.sy };
    },
    toPage(id: string, at: Point): Point | undefined {
      const place = placeOf(id);
      return place && { x: place.x + at.x * place.sx, y: place.y + at.y * place.sy };
    },
  };
}
