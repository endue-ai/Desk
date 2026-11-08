/**
 * A file tree on the browser stub, for dev pages and runtime e2e (never shipped): fs.read, fs.list,
 * fs.watch, fs.stat, fs.mkdir, fs.rename, fs.copy and fs.trash over files and folders held in memory
 * by bridge path, answered as desk-core answers them (specs/bridge/v0/README.md, ADR 0125). Each scope
 * must cover its path, both ends of a rename or a copy; `check` stands in for the grants. A name that
 * is taken is already_exists, never an overwrite; a trash is a list, never a delete. Every change is
 * an fs.changed for the watches that cover it. Hand `handlers` to `browserCore({ handlers })`.
 */
import {
  type BridgeEvent,
  type FsReadPermission,
  type FsWritePermission,
  pathMatch,
  StubError,
  type StubHandlers,
} from "@endue-ai/bridge";

type Scope = FsReadPermission | FsWritePermission;
type Node =
  | { kind: "file"; bytes: Uint8Array; modifiedAt: string; readOnly: boolean }
  | { kind: "dir"; modifiedAt: string };

export type FileTreeServed =
  | "fs.read"
  | "fs.list"
  | "fs.watch"
  | "fs.stat"
  | "fs.mkdir"
  | "fs.rename"
  | "fs.copy"
  | "fs.trash";

export interface FileTreeOptions {
  /** Files by bridge path ("~/Documents/plan.md"); the folders above them exist too. */
  files?: Record<string, string | Uint8Array>;
  /** Empty folders, by bridge path. */
  folders?: string[];
  /** Where fs.changed goes: the stub's emit. */
  emit?: (event: BridgeEvent) => void;
  /** The grant check: throw a StubError("permission_denied") unless the caller holds `scope`. */
  check?: (caller: string | undefined, scope: Scope) => void;
  /** The wall clock, for modifiedAt. */
  now?: () => number;
  /** Whether there is a trash (default true); without one, fs.trash answers unsupported. */
  trash?: boolean;
}

/** The tree as a test or a dev page sees it. */
export interface FileTree {
  /** The text of a file; undefined for a folder or nothing. */
  read(path: string): string | undefined;
  /** Every entry by path: a file's text, or null for a folder. */
  entries(): Record<string, string | null>;
  /** What fs.trash took, oldest first, by the path it had. */
  trashed(): string[];
}

const encoder = new TextEncoder();

/** `path` as desk-core normalizes it: `.`, `..` and empty segments collapsed, `${home}` as `~`. */
export function normalizePath(path: string): string {
  const home = path.replace(/^\$\{home\}(?=\/|$)/, "~");
  const match = /^(\/|~(?=\/|$)|[A-Za-z]:(?=\/|$)|\$\{[a-z]+\}(?=\/|$))/.exec(home);
  if (!match) throw new StubError("invalid_params", `not a rooted path: ${path}`);
  const root = match[1] ?? "";
  const segments: string[] = [];
  for (const segment of home.slice(root.length).split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.pop() === undefined)
        throw new StubError("invalid_params", `${path} leaves its root`);
    } else segments.push(segment);
  }
  if (segments.length === 0) return root;
  return `${root === "/" ? "" : root}/${segments.join("/")}`;
}

const isRoot = (path: string) =>
  path === "/" || path === "~" || /^[A-Za-z]:$/.test(path) || /^\$\{[a-z]+\}$/.test(path);
const parentOf = (path: string) => {
  const at = path.lastIndexOf("/");
  return at <= 0 ? "/" : path.slice(0, at);
};
const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const under = (path: string, folder: string) =>
  path.startsWith(folder === "/" ? "/" : `${folder}/`);

export function stubFileTree(options: FileTreeOptions = {}): {
  tree: FileTree;
  handlers: Required<Pick<StubHandlers, FileTreeServed>>;
} {
  const now = () => new Date(options.now?.() ?? Date.now()).toISOString();
  const nodes = new Map<string, Node>();
  const trashed: string[] = [];
  const watches = new Map<string, { path: string; recursive: boolean }>();
  let watchCount = 0;

  const changed = (path: string, change: "created" | "modified" | "removed") => {
    for (const [watchId, watch] of watches) {
      const covered = watch.recursive ? under(path, watch.path) : parentOf(path) === watch.path;
      if (covered || path === watch.path)
        setTimeout(
          () => options.emit?.({ event: "fs.changed", data: { watchId, path, change } }),
          0,
        );
    }
  };
  const exists = (path: string) => isRoot(path) || nodes.has(path);
  const isDir = (path: string) => isRoot(path) || nodes.get(path)?.kind === "dir";
  const missing = (path: string) => new StubError("not_found", `${path}: no such file or folder`);
  /** The path and every entry under it, outermost first. */
  const subtree = (path: string) =>
    [...nodes.keys()].filter((p) => p === path || under(p, path)).sort();
  const makeParents = (path: string) => {
    const made: string[] = [];
    for (let dir = parentOf(path); !exists(dir); dir = parentOf(dir)) made.unshift(dir);
    for (const dir of made) nodes.set(dir, { kind: "dir", modifiedAt: now() });
    return made;
  };
  for (const folder of options.folders ?? []) {
    const at = normalizePath(folder);
    makeParents(at);
    if (!exists(at)) nodes.set(at, { kind: "dir", modifiedAt: now() });
  }
  for (const [path, content] of Object.entries(options.files ?? {})) {
    const at = normalizePath(path);
    makeParents(at);
    const bytes = typeof content === "string" ? encoder.encode(content) : content;
    nodes.set(at, { kind: "file", bytes, modifiedAt: now(), readOnly: false });
  }

  /** The normalized path, once `scope` covers it; `grant` asks whether the caller holds `scope`. */
  const allow = (path: string, scope: Scope) => {
    const at = normalizePath(path);
    if (!scope.paths.some((pattern) => pathMatch(pattern, at)))
      throw new StubError("permission_denied", `the scope does not cover ${path}`, scope);
    return at;
  };
  const grant = (caller: string | undefined, scope: Scope) => options.check?.(caller, scope);
  /** Both ends of a rename or a copy: each scope covers its path before any grant is asked. */
  const ends = (
    caller: string | undefined,
    [fromScope, from]: [Scope, string],
    [toScope, to]: [Scope, string],
  ) => {
    const both = [allow(from, fromScope), allow(to, toScope)] as const;
    grant(caller, fromScope);
    if (toScope !== fromScope) grant(caller, toScope);
    const [source, target] = both;
    if (!exists(source)) throw missing(from);
    if (exists(target)) throw new StubError("already_exists", `${to}: already exists`);
    if (!exists(parentOf(target))) throw missing(parentOf(to));
    if (!isDir(parentOf(target)))
      throw new StubError("invalid_params", `${parentOf(to)} is not a folder`);
    if (isDir(source) && (target === source || under(target, source)))
      throw new StubError(
        "invalid_params",
        `${to} is inside ${from}, the folder it would be put in`,
      );
    return both;
  };
  const movable = (path: string) => {
    const at = normalizePath(path);
    if (isRoot(at))
      throw new StubError("invalid_params", `${path} is a root; it is never moved or trashed`);
  };
  /** Copy (`keep`) or move `source`'s subtree to `target`: the bytes carried. A move keeps the
   * times, as the OS's rename does; a copy is new. */
  const carry = (source: string, target: string, keep: boolean) => {
    let bytes = 0;
    for (const path of subtree(source)) {
      const node = nodes.get(path) as Node;
      const to = target + path.slice(source.length);
      const modifiedAt = keep ? now() : node.modifiedAt;
      if (node.kind === "file") bytes += node.bytes.length;
      nodes.set(
        to,
        node.kind === "file"
          ? { ...node, bytes: node.bytes.slice(), modifiedAt }
          : { ...node, modifiedAt },
      );
      if (!keep) nodes.delete(path);
    }
    if (!keep) changed(source, "removed");
    changed(target, "created");
    return bytes;
  };

  const handlers: Required<Pick<StubHandlers, FileTreeServed>> = {
    "fs.read": ({ path, encoding = "utf8", offset = 0, length, scope }, caller) => {
      const at = allow(path, scope);
      grant(caller, scope);
      const node = nodes.get(at);
      if (!node && !isRoot(at)) throw missing(path);
      if (!node || node.kind === "dir")
        throw new StubError("invalid_params", `${path} is a folder`);
      const end =
        length === undefined ? node.bytes.length : Math.min(node.bytes.length, offset + length);
      const part = node.bytes.subarray(Math.min(offset, node.bytes.length), end);
      const content =
        encoding === "base64" ? btoa(String.fromCharCode(...part)) : new TextDecoder().decode(part);
      return { content, encoding, size: node.bytes.length };
    },
    "fs.list": ({ path, scope }, caller) => {
      const at = allow(path, scope);
      grant(caller, scope);
      if (!exists(at)) throw missing(path);
      if (!isDir(at)) throw new StubError("invalid_params", `${path} is not a folder`);
      const entries = [...nodes]
        .filter(([p]) => p !== at && under(p, at) && parentOf(p) === at)
        .map(([p, node]) =>
          node.kind === "file"
            ? {
                name: nameOf(p),
                kind: "file" as const,
                size: node.bytes.length,
                modifiedAt: node.modifiedAt,
              }
            : { name: nameOf(p), kind: "dir" as const, modifiedAt: node.modifiedAt },
        )
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      return { entries };
    },
    "fs.watch": ({ path, recursive, scope }, caller) => {
      const at = allow(path, scope);
      grant(caller, scope);
      const watchId = `tree-w-${++watchCount}`;
      watches.set(watchId, { path: at, recursive: recursive === true });
      return { watchId };
    },
    "fs.stat": ({ path, scope }, caller) => {
      const at = allow(path, scope);
      grant(caller, scope);
      const node = nodes.get(at);
      if (!node) {
        if (isRoot(at)) return { kind: "dir", readOnly: false };
        throw missing(path);
      }
      if (node.kind === "dir") return { kind: "dir", modifiedAt: node.modifiedAt, readOnly: false };
      return {
        kind: "file",
        size: node.bytes.length,
        modifiedAt: node.modifiedAt,
        readOnly: node.readOnly,
      };
    },
    "fs.mkdir": ({ path, parents, scope }, caller) => {
      movable(path);
      const at = allow(path, scope);
      grant(caller, scope);
      if (exists(at)) throw new StubError("already_exists", `${path}: already exists`);
      const above: string[] = [];
      for (let dir = parentOf(at); !exists(dir); dir = parentOf(dir)) above.unshift(dir);
      if (above.length > 0 && parents !== true) throw missing(parentOf(path));
      for (const dir of above) allow(dir, scope);
      const parent = parentOf(above[0] ?? at);
      if (!isDir(parent)) throw new StubError("invalid_params", `${parent} is not a folder`);
      const created = [...above, at];
      for (const dir of created) {
        nodes.set(dir, { kind: "dir", modifiedAt: now() });
        changed(dir, "created");
      }
      return { created };
    },
    "fs.rename": ({ from, to, scope, fromScope }, caller) => {
      movable(from);
      const [source, target] = ends(caller, [fromScope ?? scope, from], [scope, to]);
      carry(source, target, false);
      return { crossedDevices: false };
    },
    "fs.copy": ({ from, to, scope, fromScope }, caller) => {
      const [source, target] = ends(caller, [fromScope, from], [scope, to]);
      return { bytesCopied: carry(source, target, true) };
    },
    "fs.trash": ({ path, scope }, caller) => {
      movable(path);
      const at = allow(path, scope);
      grant(caller, scope);
      if (!exists(at)) throw missing(path);
      if (options.trash === false)
        throw new StubError("unsupported", `${path}: there is no trash here; it stays`);
      for (const p of subtree(at)) nodes.delete(p);
      trashed.push(at);
      changed(at, "removed");
      return {};
    },
  };

  const tree: FileTree = {
    read: (path) => {
      const node = nodes.get(normalizePath(path));
      return node?.kind === "file" ? new TextDecoder().decode(node.bytes) : undefined;
    },
    entries: () =>
      Object.fromEntries(
        [...nodes].map(([p, node]) => [
          p,
          node.kind === "file" ? new TextDecoder().decode(node.bytes) : null,
        ]),
      ),
    trashed: () => [...trashed],
  };
  return { tree, handlers };
}
