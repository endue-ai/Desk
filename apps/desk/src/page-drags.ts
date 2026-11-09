// Drags from the OS on the CEF shell (#45, ADR 0119). A windowed CEF browser takes the OS drag
// itself; the browser process hears only that files entered, with their paths, and tells the page
// (`desk://drag-enter`, apps/desk/shell/src/drops.rs). From then on the page follows the drag in its
// own document: a cover over everything, plugin frames included, catches the drag's moves and its
// drop, so the files reach the frame under the pointer through the desk's broker as `desk/paths` (or
// open), as with the Tauri shell's window events, and never land in a frame as a bare File.

/** One drag event from the OS, its position in CSS pixels. */
export type OsDrag =
  | { type: "enter" | "drop"; paths: string[]; position: { x: number; y: number } }
  | { type: "over"; position: { x: number; y: number } }
  | { type: "leave" };

type Listen = <T>(event: string, handler: (event: { payload: T }) => void) => Promise<() => void>;

/** The shell's event when files from the OS enter the window. */
export const DRAG_ENTER = "desk://drag-enter";

interface PageDrags {
  doc: Document;
  listen: Listen;
  hear(drag: OsDrag): void;
  report(error: unknown): void;
}

/** Follow drags from the OS in `doc` until the returned function is called. */
export function followPageDrags({ doc, listen, hear, report }: PageDrags): () => void {
  let active = true;
  let unlisten: (() => void) | undefined;
  let paths: string[] | null = null;
  let cover: HTMLElement | null = null;
  let at = { x: 0, y: 0 };
  const end = () => {
    paths = null;
    cover?.remove();
    cover = null;
  };
  const start = (next: string[]) => {
    paths = next;
    if (!cover) {
      cover = doc.createElement("div");
      cover.dataset.deskOsDrag = "";
      Object.assign(cover.style, {
        position: "fixed",
        inset: "0",
        zIndex: "2147483647",
        background: "transparent",
      });
      doc.body?.append(cover);
    }
    hear({ type: "enter", paths: next, position: at });
  };
  const point = (event: MouseEvent) => {
    at = { x: event.clientX, y: event.clientY };
    return at;
  };
  const over = (event: DragEvent) => {
    if (!paths) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    hear({ type: "over", position: point(event) });
  };
  const drop = (event: DragEvent) => {
    if (!paths) return;
    event.preventDefault();
    const dropped = paths;
    end();
    hear({ type: "drop", paths: dropped, position: point(event) });
  };
  // The cover fills the window, so the drag leaving it leaves the window.
  const leave = (event: DragEvent) => {
    if (!paths || !cover || event.target !== cover) return;
    end();
    hear({ type: "leave" });
  };
  doc.addEventListener("dragover", over, true);
  doc.addEventListener("drop", drop, true);
  doc.addEventListener("dragleave", leave, true);
  void listen<{ paths?: unknown }>(DRAG_ENTER, ({ payload }) => {
    if (!active) return;
    const list = Array.isArray(payload?.paths)
      ? payload.paths.filter((path): path is string => typeof path === "string")
      : [];
    if (list.length > 0) start(list);
  })
    .then((off) => {
      if (active) unlisten = off;
      else off();
    })
    .catch(report);
  return () => {
    active = false;
    end();
    doc.removeEventListener("dragover", over, true);
    doc.removeEventListener("drop", drop, true);
    doc.removeEventListener("dragleave", leave, true);
    unlisten?.();
    unlisten = undefined;
  };
}
