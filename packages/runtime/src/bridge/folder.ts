/**
 * The desk folder on the browser stub: the runtime's own fs.read, fs.write, fs.list and fs.watch under
 * `~/.desk`, over text files held in memory, as desk-core answers the runtime (which holds fs:read on
 * `~/.desk/**` and fs:write on its profiles and keys.yaml): a write is refused as the core refuses it
 * (`checkWrite`), so a scope that fails there fails here too (#102). Every write is an fs.changed for
 * the watches that cover it, the runtime's own included, as the OS reports it. Calls a plugin makes,
 * and paths outside the folder, go to `fallback` (the page's own handlers).
 */
import {
  type BridgeEvent,
  type FsWriteParams,
  type FsWritePermission,
  pathMatch,
  StubError,
  type StubHandlers,
} from "@endue-ai/bridge";

export const DESK_ROOT = "~/.desk";
/** What desk-boot grants the runtime to write here (grants.rs, ADR 0079). */
const RUNTIME_WRITE = [`${DESK_ROOT}/profiles/**`, `${DESK_ROOT}/keys.yaml`];

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
      checkWrite(
        params,
        (dir) => dir === DESK_ROOT || [...files.keys()].some((p) => under(p, dir)),
      );
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

const under = (path: string, dir: string) => path.startsWith(`${dir}/`);
const denied = (reason: string, scope: FsWritePermission) =>
  new StubError("permission_denied", reason, scope);

/** A grant pattern covers a scope's path as desk-core's `pattern_covers` judges it (paths.rs). */
function patternCovers(grant: string, asked: string): boolean {
  if (!asked.includes("*") && !asked.includes("?")) return pathMatch(grant, asked);
  const prefix = grant.endsWith("/**") ? grant.slice(0, -3) : undefined;
  return grant === asked || (prefix !== undefined && under(asked, prefix));
}

/**
 * The runtime's fs.write in the folder, refused as desk-core refuses it (core_fs.rs, perm.rs): the
 * scope covers the path and RUNTIME_WRITE covers the scope; a folder createDirs would make is
 * inside the scope; without createDirs, the folder the file goes in is there (`exists`).
 */
function checkWrite(params: FsWriteParams, exists: (dir: string) => boolean): void {
  const { path, scope } = params;
  if (!scope.paths.some((pattern) => pathMatch(pattern, path)))
    throw denied(`the scope does not cover ${path}`, scope);
  if (!scope.paths.every((asked) => RUNTIME_WRITE.some((grant) => patternCovers(grant, asked))))
    throw denied("no grant covers the scope", scope);
  const dir = path.slice(0, path.lastIndexOf("/"));
  if (params.createDirs === true) {
    if (dir !== "~" && !scope.paths.some((pattern) => pathMatch(pattern, dir)))
      throw denied(`the scope does not cover ${dir}`, scope);
  } else if (!exists(dir)) throw missing(dir);
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
