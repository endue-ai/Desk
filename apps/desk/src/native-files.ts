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

interface FileDropHost {
  ready: Promise<void>;
  commands: { run(id: string, args: { path: string }): Promise<unknown> };
  report(error: unknown): void;
}

/** Listen before startup completes; every native drop waits for the same initialized command path. */
export function installNativeFileDrops(host: FileDropHost): () => void {
  let active = true;
  let unlisten: (() => void) | undefined;
  let queue = host.ready;
  const report = (error: unknown) => {
    if (active) host.report(error);
  };
  void getCurrentWindow()
    .onDragDropEvent(({ payload }) => {
      if (!active || payload.type !== "drop") return;
      const paths = new Set(payload.paths.map(localPath).filter((path) => path !== null));
      queue = queue
        .then(async () => {
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
