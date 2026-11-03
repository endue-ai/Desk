/**
 * The stub's writes to its in-memory files and their history (ADR 0076), as the core keeps them:
 * fs.write over a file whose bytes differ keeps the old bytes as a version first, fs.history lists a
 * file's versions newest first, and fs.restore writes one back as a write of its own, so what it
 * replaces is kept too. 50 versions per path, no byte budget; ids count up from the clock.
 */
import { StubError, type StubHandlers } from "./adapters";
import type { Encoding, FsReadPermission, FsVersion, FsWritePermission } from "./generated";

export type HistoryServed = "fs.write" | "fs.history" | "fs.restore";

/** The stub's check of one call: throws permission_denied unless a grant covers the scope and the
 * scope the path. */
export type Allow = (
  caller: string | undefined,
  path: string,
  scope: FsReadPermission | FsWritePermission,
) => void;

const MAX_VERSIONS = 50;

/** Hears each write that kept a version, for the undo stack (stub-undo.ts). */
export type Wrote = (caller: string, command: string, path: string, version: string) => void;

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function decode(content: string, encoding: Encoding | undefined): Uint8Array {
  if (encoding !== "base64") return new TextEncoder().encode(content);
  try {
    return Uint8Array.from(atob(content), (c) => c.charCodeAt(0));
  } catch {
    throw new StubError("invalid_params", "not base64");
  }
}

const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

/**
 * fs.write, fs.history and fs.restore over `files` (shared with fs.read and fs.url), each call
 * checked as `allow` says; versions are stamped with `now`.
 */
export function stubHistory(
  files: Map<string, Uint8Array>,
  allow: Allow,
  now: () => string,
  wrote?: Wrote,
): Required<Pick<StubHandlers, HistoryServed>> {
  const kept = new Map<string, Array<{ version: FsVersion; bytes: Uint8Array }>>();
  let lastMillis = 0;
  let count = 0;
  const nextId = () => {
    lastMillis = Math.max(Date.parse(now()) || 0, lastMillis + 1);
    count += 1;
    return `${lastMillis}-${count.toString(16).padStart(6, "0").slice(-6)}`;
  };

  /** Write `bytes` over `path` as `caller`, keeping what it replaces; answers as fs.write. */
  const write = async (
    caller: string | undefined,
    path: string,
    bytes: Uint8Array,
    command: "fs.write" | "fs.restore",
  ) => {
    if ([...files.keys()].some((p) => p.startsWith(`${path}/`)))
      throw new StubError("invalid_params", `${path} is a folder`);
    const old = files.get(path);
    files.set(path, bytes);
    if (!old || same(old, bytes)) return { bytesWritten: bytes.length };
    const version: FsVersion = {
      id: nextId(),
      at: now(),
      caller: caller ?? "desk",
      size: old.length,
      sha256: await sha256(old),
    };
    kept.set(path, [{ version, bytes: old }, ...(kept.get(path) ?? [])].slice(0, MAX_VERSIONS));
    wrote?.(caller ?? "desk", command, path, version.id);
    return { bytesWritten: bytes.length, version: version.id };
  };

  return {
    "fs.write": ({ path, content, encoding, scope }, caller) => {
      allow(caller, path, scope);
      return write(caller, path, decode(content, encoding), "fs.write");
    },
    "fs.history": ({ path, limit, scope }, caller) => {
      allow(caller, path, scope);
      const versions = (kept.get(path) ?? []).map((k) => structuredClone(k.version));
      return { versions: limit === undefined ? versions : versions.slice(0, limit) };
    },
    "fs.restore": ({ path, version, scope }, caller) => {
      allow(caller, path, scope);
      const found = kept.get(path)?.find((k) => k.version.id === version);
      if (!found) throw new StubError("not_found", `${path} has no version ${version}`);
      return write(caller, path, found.bytes.slice(), "fs.restore");
    },
  };
}
