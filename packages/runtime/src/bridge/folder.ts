/**
 * The desk folder on the browser stub: the runtime's own fs.read, fs.write, fs.list and fs.watch under
 * `~/.desk`, over text files held in memory, as desk-core answers the runtime (which holds fs:read on
 * `~/.desk/**` and fs:write on its profiles and keys.yaml). Every write is an fs.changed for the
 * watches that cover it, the runtime's own included, as the OS reports it. Calls a plugin makes, and
 * paths outside the folder, go to `fallback` (the page's own handlers).
 */
import { type BridgeEvent, StubError, type StubHandlers } from "@endue-ai/bridge";

export const DESK_ROOT = "~/.desk";

/** The desk folder's files as a test or a dev page sees them. */
export interface StubFolder {
  read(path: string): string | undefined;
  /** Write a file as the person would by hand: the watches hear it. */
  write(path: string, text: string): void;
  /** Delete a file as the person would: the watches hear it. */
  remove(path: string): void;
  /** Every file by path. */
  files(): Record<string, string>;
}

const inFolder = (path: string) => path === DESK_ROOT || path.startsWith(`${DESK_ROOT}/`);
const missing = (path: string) => new StubError("not_found", `${path}: no such file or folder`);

/** The folder over `initial`, the handlers that serve it, and the files it holds. */
export function stubFolder(
  initial: Record<string, string>,
  emit: (event: BridgeEvent) => void,
  fallback: StubHandlers = {},
  keep?: (files: Record<string, string>) => void,
): { folder: StubFolder; handlers: StubHandlers } {
  const files = new Map(Object.entries(initial));
  const watches = new Map<string, { path: string; recursive: boolean }>();
  let next = 0;

  const changed = (path: string, change: "created" | "modified" | "removed") => {
    keep?.(Object.fromEntries(files));
    for (const [watchId, watch] of watches) {
      const parent = path.slice(0, path.lastIndexOf("/"));
      const covered = watch.recursive ? path.startsWith(`${watch.path}/`) : parent === watch.path;
      if (covered || path === watch.path)
        setTimeout(() => emit({ event: "fs.changed", data: { watchId, path, change } }), 0);
    }
  };
  const put = (path: string, text: string) => {
    const change = files.has(path) ? "modified" : "created";
    files.set(path, text);
    changed(path, change);
  };
  const folder: StubFolder = {
    read: (path) => files.get(path),
    write: put,
    remove: (path) => {
      if (files.delete(path)) changed(path, "removed");
    },
    files: () => Object.fromEntries(files),
  };

  const handlers: StubHandlers = {
    "fs.read": (params, caller) => {
      if (caller !== undefined || !inFolder(params.path))
        return passOn(fallback, "fs.read")(params, caller);
      const text = files.get(params.path);
      if (text === undefined) throw missing(params.path);
      return { content: text, encoding: "utf8", size: new TextEncoder().encode(text).length };
    },
    "fs.write": (params, caller) => {
      if (caller !== undefined || !inFolder(params.path))
        return passOn(fallback, "fs.write")(params, caller);
      put(params.path, params.content);
      return { bytesWritten: new TextEncoder().encode(params.content).length };
    },
    "fs.list": (params, caller) => {
      if (caller !== undefined || !inFolder(params.path))
        return passOn(fallback, "fs.list")(params, caller);
      const prefix = `${params.path}/`;
      const names = new Map<string, "file" | "dir">();
      for (const path of files.keys()) {
        if (!path.startsWith(prefix)) continue;
        const [name, ...rest] = path.slice(prefix.length).split("/");
        if (name) names.set(name, rest.length > 0 ? "dir" : "file");
      }
      if (names.size === 0 && params.path !== DESK_ROOT) throw missing(params.path);
      return { entries: [...names].sort().map(([name, kind]) => ({ name, kind })) };
    },
    "fs.watch": (params, caller) => {
      if (caller !== undefined || !inFolder(params.path))
        return passOn(fallback, "fs.watch")(params, caller);
      const watchId = `desk-w-${++next}`;
      watches.set(watchId, { path: params.path, recursive: params.recursive === true });
      return { watchId };
    },
  };
  return { folder, handlers };
}

/** The page's own handler for `method`, or an answer that nobody serves it. */
function passOn<M extends "fs.read" | "fs.write" | "fs.list" | "fs.watch">(
  fallback: StubHandlers,
  method: M,
): NonNullable<StubHandlers[M]> {
  const handler = fallback[method];
  if (handler) return handler;
  return (() => {
    throw new StubError("unsupported", `${method} is not served here`);
  }) as unknown as NonNullable<StubHandlers[M]>;
}
