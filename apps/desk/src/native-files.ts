// Files from the OS: the file picker and drags from Finder, Explorer or a file manager. The Tauri
// shell gives both through its plugins and its window; the CEF shell (#45) answers the dialog's
// own command (`plugin:dialog|open`, apps/desk/shell/src/dialog.rs) and says which files a drag
// carries when it enters (`desk://drag-enter`, drops.rs), the page following the rest of the drag.
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke, listen, shell } from "./host";
import { followPageDrags, type OsDrag } from "./page-drags";

/** Native paths only: DOM File.name and browser URLs are not filesystem authority. */
export function localPath(value: string): string | null {
  if (!value || value.includes("\0")) return null;
  if (value.startsWith("/")) return value;
  // POSIX filenames may contain backslashes; only Windows paths need separator conversion.
  if (/^[a-z]:[\\/]/i.test(value) || value.startsWith("\\\\")) return value.replaceAll("\\", "/");
  return null;
}

export async function pickNativeFile(): Promise<string | null> {
  const options = { multiple: false, directory: false };
  const path =
    shell === "cef"
      ? await invoke<string | string[] | null>("plugin:dialog|open", { options })
      : await open(options);
  return typeof path === "string" ? localPath(path) : null;
}

/**
 * How the app tells the desk's page about a drag from the OS (ADR 0119). The runtime's
 * `packages/runtime/src/dnd/native.ts` hears it and offers the paths as `desk/paths` to the plugin
 * frame under the pointer; on a drop it sets `taken`.
 */
export const NATIVE_DRAG = "desk:native-drag";
interface NativeDrag {
  phase: "enter" | "over" | "drop" | "leave";
  paths?: string[];
  x?: number;
  y?: number;
  taken?: Promise<boolean>;
}

interface FileDropHost {
  ready: Promise<void>;
  commands: { run(id: string, args: { path: string }): Promise<unknown> };
  report(error: unknown): void;
  /** The desk's page, which hears drags from the OS; the window by default. */
  page?: EventTarget;
  /** Physical pixels per CSS pixel (Tauri's positions are physical); devicePixelRatio by default. */
  scale?(): number;
  /** The document a drag follows on the CEF shell; the page's own by default. */
  doc?: Document;
}

/**
 * Listen before startup completes. A file dragged from the OS over a plugin that takes paths reaches
 * that plugin; one dropped anywhere else opens, every drop waiting for the same initialized command
 * path.
 */
export function installNativeFileDrops(host: FileDropHost): () => void {
  let active = true;
  let queue = host.ready;
  const page = host.page ?? globalThis.window;
  const report = (error: unknown) => {
    if (active) host.report(error);
  };
  const tell = (detail: NativeDrag) => {
    page?.dispatchEvent(new CustomEvent(NATIVE_DRAG, { detail }));
    return detail;
  };
  // One drag event, its position in CSS pixels.
  const hear = (drag: OsDrag) => {
    if (!active) return;
    if (drag.type === "leave") {
      tell({ phase: "leave" });
      return;
    }
    const at = { x: drag.position.x, y: drag.position.y };
    if (drag.type === "over") {
      tell({ phase: "over", ...at });
      return;
    }
    const paths = [...new Set(drag.paths.map(localPath).filter((path) => path !== null))];
    if (drag.type === "enter") {
      tell({ phase: "enter", paths, ...at });
      return;
    }
    const taken = tell({ phase: "drop", paths, ...at }).taken ?? Promise.resolve(false);
    queue = queue
      .then(async () => {
        // A plugin under the pointer took the paths: they are its now, not the desk's to open.
        if (await taken.catch(() => false)) return;
        for (const path of paths) {
          if (!active) return;
          try {
            await host.commands.run("desk.files.open", { path });
          } catch (error) {
            report(error);
          }
        }
      })
      .catch(report);
  };
  const stop =
    shell === "cef"
      ? followPageDrags({ doc: host.doc ?? globalThis.document, listen, hear, report })
      : followTauriDrags(host, hear, report);
  return () => {
    active = false;
    stop();
  };
}

/** Tauri's window drag-drop events, its physical positions as CSS pixels. */
function followTauriDrags(
  host: FileDropHost,
  hear: (drag: OsDrag) => void,
  report: (error: unknown) => void,
): () => void {
  let active = true;
  let unlisten: (() => void) | undefined;
  const scale = () => host.scale?.() ?? globalThis.devicePixelRatio ?? 1;
  const css = (position: { x: number; y: number }) => {
    const ratio = scale() || 1;
    return { x: position.x / ratio, y: position.y / ratio };
  };
  void getCurrentWindow()
    .onDragDropEvent(({ payload }) => {
      if (payload.type === "leave") hear({ type: "leave" });
      else if (payload.type === "over") hear({ type: "over", position: css(payload.position) });
      else hear({ type: payload.type, paths: payload.paths, position: css(payload.position) });
    })
    .then((off) => {
      if (active) unlisten = off;
      else off();
    })
    .catch(report);
  return () => {
    active = false;
    unlisten?.();
    unlisten = undefined;
  };
}
