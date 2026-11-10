// Drags from the operating system (Finder, Explorer, a file manager) join the same contract (ADR
// 0119). The app hears them from the shell (apps/desk/src/native-files.ts) and tells the desk's page with
// a `desk:native-drag` event, in CSS pixels; the broker offers them as `desk/paths` to the frame under
// the pointer. On a drop it sets `taken`: true once a plugin performed an effect, so the app opens
// the files itself only when no plugin took them. Plugin frames cannot dispatch it: they are
// cross-origin to this page.
import type { DragBroker } from "./broker";

export const NATIVE_DRAG = "desk:native-drag";

export interface NativeDrag {
  phase: "enter" | "over" | "drop" | "leave";
  paths?: string[];
  x?: number;
  y?: number;
  /** Set by the desk on a drop. */
  taken?: Promise<boolean>;
}

export function listenNative(win: Window, broker: () => DragBroker): () => void {
  const on = (event: Event) => {
    const detail = (event as CustomEvent<NativeDrag>).detail;
    if (!detail || typeof detail !== "object") return;
    const at = { x: Number(detail.x) || 0, y: Number(detail.y) || 0 };
    const paths = Array.isArray(detail.paths)
      ? detail.paths.filter((p): p is string => typeof p === "string")
      : [];
    const desk = broker();
    switch (detail.phase) {
      case "enter":
        desk.enterNative(paths, at);
        break;
      case "over":
        if (desk.from === "os") desk.pointer(at);
        break;
      case "drop":
        if (!desk.active) desk.enterNative(paths, at);
        detail.taken =
          desk.from === "os"
            ? desk.release(at).then((outcome) => outcome.effect !== "none")
            : Promise.resolve(false);
        break;
      case "leave":
        if (desk.from === "os") desk.cancel();
        break;
    }
  };
  win.addEventListener(NATIVE_DRAG, on);
  return () => win.removeEventListener(NATIVE_DRAG, on);
}
