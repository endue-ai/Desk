/**
 * The desk folder (`~/.desk`) as the runtime reads and writes it: the files the person writes, in
 * YAML (ADR 0079). Calls go through the bridge under the runtime's own grants (fs:read on the folder,
 * fs:write on profiles/ and keys.yaml). One recursive fs.watch on the folder, started for the first
 * listener, says which file changed, so a hand edit applies without a restart; a core that cannot
 * watch leaves the files read at start.
 */
import type { BridgeClient, FsReadPermission, FsWritePermission } from "@endue-ai/bridge";

export const DESK_DIR = "~/.desk";
const READ: FsReadPermission = { permission: "fs:read", paths: [`${DESK_DIR}/**`] };

export interface DeskFolder {
  /** The file's text, or undefined when there is none (or it cannot be read). */
  read(path: string): Promise<string | undefined>;
  /** Create or replace the file, and its folder when missing. */
  write(path: string, text: string): Promise<void>;
  /** The names of the files in a folder; none when it is missing. */
  list(dir: string): Promise<string[]>;
  /** Hear the path of each file that changed on disk, whoever changed it. */
  onChange(listener: (path: string) => void): () => void;
  dispose(): void;
}

export function deskFolder(bridge: BridgeClient): DeskFolder {
  const listeners = new Set<(path: string) => void>();
  let watchId: string | undefined;
  let watching: Promise<void> | undefined;
  let off: (() => void) | undefined;

  const watch = () => {
    watching ??= (async () => {
      off = bridge.onEvent((event) => {
        if (event.event !== "fs.changed" || event.data.watchId !== watchId) return;
        for (const listener of [...listeners]) listener(event.data.path);
      });
      try {
        ({ watchId } = await bridge.call("fs.watch", {
          path: DESK_DIR,
          recursive: true,
          scope: READ,
        }));
      } catch {
        // No grant, no folder or an older core: the files stay as read at start.
      }
    })();
    return watching;
  };

  return {
    read: async (path) => {
      try {
        return (await bridge.call("fs.read", { path, encoding: "utf8", scope: READ })).content;
      } catch {
        return undefined;
      }
    },
    write: async (path, text) => {
      const scope: FsWritePermission = { permission: "fs:write", paths: [path] };
      await bridge.call("fs.write", {
        path,
        content: text,
        encoding: "utf8",
        createDirs: true,
        scope,
      });
    },
    list: async (dir) => {
      try {
        const { entries } = await bridge.call("fs.list", { path: dir, scope: READ });
        return entries.filter((entry) => entry.kind === "file").map((entry) => entry.name);
      } catch {
        return [];
      }
    },
    onChange: (listener) => {
      listeners.add(listener);
      void watch();
      return () => listeners.delete(listener);
    },
    dispose: () => {
      listeners.clear();
      off?.();
    },
  };
}
