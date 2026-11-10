// Files from the OS: the file picker and drags from Finder, Explorer or a file manager. The CEF
// shell (#45) answers the dialog's command (`plugin:dialog|open`, apps/desk/shell/src/dialog.rs) and
// says which files a drag carries when it enters (`desk://drag-enter`, drops.rs), the page following
// the rest of the drag.
import { invoke, listen } from "./host";
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
  const path = await invoke<string | string[] | null>("plugin:dialog|open", { options });
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
  /** The document a drag follows; the page's own by default. */
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
  const stop = followPageDrags({ doc: host.doc ?? globalThis.document, listen, hear, report });
  return () => {
    active = false;
    stop();
  };
}
