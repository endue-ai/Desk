// A container's files (DOCK-22): a folder listed with the container's own `ls -lA` (GNU, BusyBox and
// toybox all print the same long format), and `docker cp` out to this computer or in from it. Every
// path is checked: absolute, no NUL, and the container side always `ID:/path`, so neither ever reads
// as an option. A drop copies in through the same command (drop.js), and a container's file dragged
// to a folder elsewhere copies out through it (dnd.js).

import { hostPath } from "./images.js";

/**
 * @typedef {"dir" | "file" | "link" | "other"} Kind
 * @typedef {{ name: string, path: string, kind: Kind, size: string, mode: string, modified: string,
 *   target: string }} Entry
 */

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

/** The folder a path is in; the root is its own. */
export const parentOf = (/** @type {string} */ path) =>
  containerPath(path.slice(0, path.lastIndexOf("/")) || "/");

/** A path inside a folder. */
export const childOf = (/** @type {string} */ dir, /** @type {string} */ name) =>
  containerPath(`${dir}/${name}`);

/** `docker exec ID ls -lA -- PATH`: the container's own ls, no shell. */
export const lsArgs = (/** @type {string} */ id, /** @type {string} */ path) => [
  "exec",
  "--",
  id,
  "ls",
  "-lA",
  "--",
  containerPath(path),
];

const LINE =
  /^([-dlcbps])([-rwxsStT]{9})[.+@]?\s+\d+\s+\S+\s+\S+\s+((?:\d+,\s*)?\d+)\s+(\w{3}\s+\d{1,2}\s+(?:\d{1,2}:\d{2}|\d{4}))\s(.+)$/;
const KINDS = /** @type {Record<string, Kind>} */ ({ d: "dir", "-": "file", l: "link" });

/** `ls -lA`'s lines as entries, folders first, then by name. Lines it cannot read are skipped. */
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
      size: kind === "file" ? size : "",
      mode: `${type}${perms}`,
      modified: modified.replace(/\s+/g, " "),
      target: arrow >= 0 ? rest.slice(arrow + 4) : "",
    });
  }
  return out.sort(
    (a, b) => Number(b.kind === "dir") - Number(a.kind === "dir") || a.name.localeCompare(b.name),
  );
}

/** `docker cp -- ID:PATH DEST`: a file or folder of the container into a folder of this computer. */
export const copyOutArgs = (
  /** @type {string} */ id,
  /** @type {unknown} */ path,
  /** @type {unknown} */ dest,
) => ["cp", "--", `${id}:${containerPath(path)}`, hostPath(dest, "The destination")];

/** `docker cp -- SOURCE ID:PATH`: a file or folder of this computer into a folder of the container. */
export const copyInArgs = (
  /** @type {unknown} */ source,
  /** @type {string} */ id,
  /** @type {unknown} */ path,
) => ["cp", "--", hostPath(source, "The source"), `${id}:${containerPath(path)}`];

/**
 * A path of this computer as docker's argument, the folder docker runs in for it, and how it reads.
 * docker runs without a shell, so `~` is never expanded: a home-relative path (what the explorer
 * and the desk name) runs docker in the home folder, which the core resolves, as `./rest`. The `./`
 * also keeps a name with a colon from reading as a container's path.
 * @param {unknown} value
 * @param {string} [what]
 * @returns {{ arg: string, cwd?: string, shown: string }}
 */
export function localPath(value, what = "The path") {
  if (typeof value === "string" && (value === "~" || value.startsWith("~/"))) {
    const rest = value.slice(2).replace(/\/+$/, "");
    if (value.includes("\0") || rest.split("/").includes(".."))
      throw new Error(`${what} ${JSON.stringify(value)} is not a path on this computer.`);
    return {
      arg: rest === "" ? "." : `./${rest}`,
      cwd: "~",
      shown: rest === "" ? "~" : `~/${rest}`,
    };
  }
  const arg = hostPath(value, what);
  return { arg, shown: arg };
}

/**
 * `docker cp -- SOURCE ID:PATH` for a source anywhere on this computer. `into` names PATH a folder
 * (`PATH/`): docker then refuses one that is not there, instead of writing the file under its name.
 */
export function copyInCommand(
  /** @type {unknown} */ source,
  /** @type {string} */ id,
  /** @type {unknown} */ path,
  into = false,
) {
  const from = localPath(source, "The source");
  const at = containerPath(path);
  const to = into && at !== "/" ? `${at}/` : at;
  return { args: ["cp", "--", from.arg, `${id}:${to}`], ...(from.cwd ? { cwd: from.cwd } : {}) };
}

/** `docker cp -- ID:PATH DEST` for a destination anywhere on this computer. */
export function copyOutCommand(
  /** @type {string} */ id,
  /** @type {unknown} */ path,
  /** @type {unknown} */ dest,
) {
  const to = localPath(dest, "The destination");
  const args = ["cp", "--", `${id}:${containerPath(path)}`, to.arg];
  return { args, ...(to.cwd ? { cwd: to.cwd } : {}) };
}

/** What ls said when the container cannot list: no ls in the image, or it is not running. */
export function lsProblem(/** @type {string} */ message) {
  if (/executable file not found|no such file or directory.*ls|"ls"/i.test(message))
    return "This image has no ls (a distroless or scratch image): copy a path out to read it.";
  if (/is not running|is paused/i.test(message))
    return "Start the container to browse its files; copying out works while it is stopped.";
  return message;
}
