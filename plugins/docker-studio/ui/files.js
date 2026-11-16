// A running container's files: a folder listed by the container's own `ls -lA` (GNU, BusyBox and
// toybox print the same long format), a file's first 256 KiB read with `head -c`. Every path is
// checked: absolute, no NUL, `.` and `..` resolved, and it comes after `--`. Pure but for the args.

import { objectRef } from "./refs.js";

/**
 * @typedef {"dir" | "file" | "link" | "other"} Kind
 * @typedef {{ name: string, path: string, kind: Kind, size: number, mode: string, modified: string, target: string }} Entry
 */

export const PREVIEW_BYTES = 256 * 1024;

/** A path inside a container: absolute, without a NUL, `.` and `..` resolved, no trailing slash. */
export function containerPath(/** @type {unknown} */ value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.includes("\0"))
    throw new Error(`${JSON.stringify(value)} is not an absolute path in the container.`);
  /** @type {string[]} */
  const parts = [];
  for (const part of value.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

export const parentOf = (/** @type {string} */ path) =>
  containerPath(path.slice(0, path.lastIndexOf("/")) || "/");
export const childOf = (/** @type {string} */ dir, /** @type {string} */ name) =>
  containerPath(`${dir}/${name}`);

/** The folders from the root to a path, for the breadcrumbs. */
export function crumbs(/** @type {string} */ path) {
  const parts = containerPath(path).split("/").filter(Boolean);
  return [
    { name: "/", path: "/" },
    ...parts.map((name, i) => ({ name, path: `/${parts.slice(0, i + 1).join("/")}` })),
  ];
}

export const lsArgs = (/** @type {string} */ id, /** @type {string} */ path) => [
  "exec",
  "--",
  objectRef(id),
  "ls",
  "-lA",
  "--",
  containerPath(path),
];

export const readArgs = (/** @type {string} */ id, /** @type {string} */ path) => [
  "exec",
  "--",
  objectRef(id),
  "head",
  "-c",
  String(PREVIEW_BYTES),
  "--",
  containerPath(path),
];

const LINE =
  /^([-dlcbps])([-rwxsStT]{9})[.+@]?\s+\d+\s+\S+\s+\S+\s+((?:\d+,\s*)?\d+)\s+(\w{3}\s+\d{1,2}\s+(?:\d{1,2}:\d{2}|\d{4}))\s(.+)$/;
const KINDS = /** @type {Record<string, Kind>} */ ({ d: "dir", "-": "file", l: "link" });

/** `ls -lA`'s lines as entries, folders first, then by name; lines it cannot read are skipped. */
export function parseLs(/** @type {string} */ stdout, /** @type {string} */ dir) {
  /** @type {Entry[]} */
  const out = [];
  for (const line of stdout.split("\n")) {
    const found = LINE.exec(line.trimEnd());
    if (!found) continue;
    const [, type = "", perms = "", size = "", modified = "", rest = ""] = found;
    const kind = KINDS[type] ?? "other";
    const arrow = kind === "link" ? rest.indexOf(" -> ") : -1;
    const name = arrow >= 0 ? rest.slice(0, arrow) : rest;
    if (name === "." || name === ".." || name.includes("/")) continue;
    out.push({
      name,
      path: childOf(dir, name),
      kind,
      size: kind === "file" ? Number(size) || 0 : 0,
      mode: `${type}${perms}`,
      modified: modified.replace(/\s+/g, " "),
      target: arrow >= 0 ? rest.slice(arrow + 4) : "",
    });
  }
  return out.sort(
    (a, b) => Number(b.kind === "dir") - Number(a.kind === "dir") || a.name.localeCompare(b.name),
  );
}

/** Whether what `head` read is text (no NUL in it). */
export const isText = (/** @type {string} */ text) => !text.includes("\0");

/** Images a helper container can list a volume with, smallest first: they all have ls and head. */
const HELPERS = [
  /^(docker\.io\/)?(library\/)?busybox:/,
  /^(docker\.io\/)?(library\/)?alpine:/,
  /-alpine$/,
  /^(docker\.io\/)?(library\/)?(debian|ubuntu):/,
  /-slim$/,
];

/** The local image a helper container should use for a volume, or "" when there is none. */
export function helperImage(/** @type {import("./parse.js").Image[]} */ images) {
  const refs = images.flatMap((i) => i.refs.map((ref) => ({ ref, size: i.size })));
  for (const pattern of HELPERS) {
    const found = refs.filter((r) => pattern.test(r.ref)).sort((a, b) => a.size - b.size)[0];
    if (found) return found.ref;
  }
  return "";
}

/**
 * Where a volume's files are read: in a running container that mounts it (docker exec, under
 * its mount point), or else in a helper container that mounts it read-only, with no network,
 * and is removed when it is done (docker run --rm).
 * @param {string} volume @param {import("./parse.js").Container | undefined} running
 * @param {string} helper
 */
export function volumeTarget(volume, running, helper) {
  const mount = running?.mounts.find((m) => m.type === "volume" && m.name === volume);
  if (running && mount) {
    const base = containerPath(mount.destination);
    return {
      root: base,
      ls: (/** @type {string} */ path) => lsArgs(running.id, path),
      read: (/** @type {string} */ path) => readArgs(running.id, path),
    };
  }
  const run = (/** @type {string} */ tool, /** @type {string[]} */ rest) => [
    "run",
    "--rm",
    "--network",
    "none",
    "--volume",
    `${objectRef(volume, "The volume")}:/volume:ro`,
    "--entrypoint",
    tool,
    "--",
    helper,
    ...rest,
  ];
  return {
    root: "/volume",
    ls: (/** @type {string} */ path) => run("ls", ["-lA", "--", containerPath(path)]),
    read: (/** @type {string} */ path) =>
      run("head", ["-c", String(PREVIEW_BYTES), "--", containerPath(path)]),
  };
}
