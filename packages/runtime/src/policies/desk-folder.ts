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
  /** Move the file to the Trash; whether it went (where there is no trash, it stays). */
  trash(path: string): Promise<boolean>;
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
      // The core makes only folders the scope covers (#102): a file in a folder of the desk folder
      // (profiles/) names that folder in its scope too. One at the top (keys.yaml) asks for no
      // folder, which the runtime's grant could not cover: the core makes ~/.desk itself.
      const dir = path.slice(0, path.lastIndexOf("/"));
      const nested = dir !== DESK_DIR;
      const scope: FsWritePermission = {
        permission: "fs:write",
        paths: nested ? [path, dir] : [path],
      };
      await bridge.call("fs.write", {
        path,
        content: text,
        encoding: "utf8",
        ...(nested ? { createDirs: true } : {}),
        scope,
      });
    },
    trash: async (path) => {
      try {
        await bridge.call("fs.trash", { path, scope: { permission: "fs:write", paths: [path] } });
        return true;
      } catch {
        return false;
      }
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
