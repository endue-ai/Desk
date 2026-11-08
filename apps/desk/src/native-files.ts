import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";

/** Native paths only: DOM File.name and browser URLs are not filesystem authority. */
function localPath(value: string): string | null {
  if (!value || value.includes("\0")) return null;
  if (value.startsWith("/")) return value;
  // POSIX filenames may contain backslashes; only Windows paths need separator conversion.
  if (/^[a-z]:[\\/]/i.test(value) || value.startsWith("\\\\")) return value.replaceAll("\\", "/");
  return null;
}

export async function pickNativeFile(): Promise<string | null> {
  const path = await open({ multiple: false, directory: false });
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
}

/**
 * Listen before startup completes. A file dragged from the OS over a plugin that takes paths reaches
 * that plugin; one dropped anywhere else opens, every drop waiting for the same initialized command
 * path.
 */
export function installNativeFileDrops(host: FileDropHost): () => void {
  let active = true;
  let unlisten: (() => void) | undefined;
  let queue = host.ready;
  const page = host.page ?? globalThis.window;
  const scale = () => host.scale?.() ?? globalThis.devicePixelRatio ?? 1;
  const report = (error: unknown) => {
    if (active) host.report(error);
  };
  const tell = (detail: NativeDrag) => {
    page?.dispatchEvent(new CustomEvent(NATIVE_DRAG, { detail }));
    return detail;
  };
  const css = (position: { x: number; y: number }) => {
    const ratio = scale() || 1;
    return { x: position.x / ratio, y: position.y / ratio };
  };
  void getCurrentWindow()
    .onDragDropEvent(({ payload }) => {
      if (!active) return;
      if (payload.type === "leave") {
        tell({ phase: "leave" });
        return;
      }
      const at = css(payload.position);
      if (payload.type === "over") {
        tell({ phase: "over", ...at });
        return;
      }
      const paths = [...new Set(payload.paths.map(localPath).filter((path) => path !== null))];
      if (payload.type === "enter") {
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
