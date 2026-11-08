// What the image pane and the image operations read: an image's layers (`image history`, DOCK-21),
// what `image inspect` says it runs, a pull's progress from its plain output, and a build
// (DOCK-20): its arguments, checked, and its steps from BuildKit's plain progress. Parsing never throws.

import { stripAnsi } from "./errors.js";
import { parseSize } from "./overview.js";
import { records } from "./parse-list.js";
import { imageRef } from "./refs.js";

/**
 * @typedef {{ id: string, created: string, createdBy: string, size: string, bytes: number,
 *   comment: string }} Layer
 * @typedef {{ id: string, os: string, arch: string, created: string, size: number, user: string,
 *   workdir: string, entrypoint: string, cmd: string, env: string[], ports: string[],
 *   labels: Array<[string, string]>, layers: number }} ImageInfo
 * @typedef {{ done: number, total: number, status: string }} Progress
 */

/** `docker image history --no-trunc --format '{{json .}}' -- REF`. */
export const historyArgs = (/** @type {string} */ ref) => [
  "image",
  "history",
  "--no-trunc",
  "--format",
  "{{json .}}",
  "--",
  ref,
];

const str = (/** @type {unknown} */ value) => (typeof value === "string" ? value : "");

/** The layers, newest first as docker prints them. The `/bin/sh -c #(nop) ` docker 1.x put on each instruction is taken off. */
export function parseHistory(/** @type {string} */ stdout) {
  return records(stdout).map(
    (r) =>
      /** @type {Layer} */ ({
        id: str(r.ID) === "<missing>" ? "" : str(r.ID),
        created: str(r.CreatedAt),
        createdBy: str(r.CreatedBy)
          .replace(/^\/bin\/sh -c #\(nop\)\s*/, "")
          .replace(/\s+/g, " ")
          .trim(),
        size: str(r.Size),
        bytes: parseSize(str(r.Size)),
        comment: str(r.Comment),
      }),
  );
}

const argv = (/** @type {unknown} */ value) =>
  Array.isArray(value)
    ? value.map((part) => (/\s/.test(String(part)) ? JSON.stringify(part) : String(part))).join(" ")
    : "";

/** One element of `docker image inspect`'s array as what the Info tab shows. */
export function imageInfo(/** @type {unknown} */ json) {
  const i = /** @type {Record<string, any>} */ (json && typeof json === "object" ? json : {});
  const config = /** @type {Record<string, any>} */ (i.Config ?? {});
  return /** @type {ImageInfo} */ ({
    id: str(i.Id),
    os: str(i.Os),
    arch: [str(i.Architecture), str(i.Variant)].filter(Boolean).join("/"),
    created: str(i.Created),
    size: Number(i.Size) || 0,
    user: str(config.User),
    workdir: str(config.WorkingDir),
    entrypoint: argv(config.Entrypoint),
    cmd: argv(config.Cmd),
    env: Array.isArray(config.Env) ? config.Env.map(String) : [],
    ports: Object.keys(config.ExposedPorts ?? {}),
    labels: Object.entries(config.Labels ?? {})
      .map(([k, v]) => /** @type {[string, string]} */ ([k, String(v)]))
      .sort(([a], [b]) => a.localeCompare(b)),
    layers: Array.isArray(i.RootFS?.Layers) ? i.RootFS.Layers.length : 0,
  });
}

/**
 * A pull's progress from what `docker pull` prints without a terminal: a line per layer and
 * status ("abc123: Pull complete"), then "Status: …". Layers that exist already count as done.
 */
export function createPullProgress() {
  /** @type {Map<string, string>} */
  const layers = new Map();
  let status = "Starting…";
  return {
    /** @param {string} raw @returns {Progress} */
    feed(raw) {
      const line = stripAnsi(raw).trim();
      const layer = /^([0-9a-f]{12}): (.+)$/.exec(line);
      if (layer) layers.set(layer[1] ?? "", layer[2] ?? "");
      else if (/^Status: /.test(line)) status = line.slice(8);
      else if (/: Pulling from /.test(line)) status = line;
      return this.progress();
    },
    /** @returns {Progress} */
    progress() {
      const done = [...layers.values()].filter((s) =>
        /^(Pull complete|Already exists)/.test(s),
      ).length;
      return { done, total: layers.size, status };
    },
  };
}

/**
 * A build's progress from `--progress plain`: steps are "#5 [2/4] RUN …", finished by "#5 DONE 1.2s"
 * or "#5 CACHED"; an error is "#5 ERROR: …".
 */
export function createBuildProgress() {
  /** @type {Map<string, { name: string, index: number, of: number, done: boolean }>} */
  const steps = new Map();
  let status = "Starting…";
  let error = "";
  return {
    /** @param {string} raw @returns {Progress & { error: string }} */
    feed(raw) {
      const line = stripAnsi(raw).trim();
      const found = /^#(\d+) (.*)$/.exec(line);
      if (found) {
        const [, id = "", rest = ""] = found;
        const step = /^\[(?:[^\]\s]+ )?(\d+)\/(\d+)\] (.*)$/.exec(rest);
        if (step) {
          steps.set(id, {
            name: step[3] ?? "",
            index: Number(step[1]),
            of: Number(step[2]),
            done: false,
          });
          status = `Step ${step[1]}/${step[2]}: ${step[3]}`;
        } else if (/^(DONE|CACHED)\b/.test(rest)) {
          const known = steps.get(id);
          if (known) known.done = true;
        } else if (/^ERROR\b/.test(rest)) error = rest.replace(/^ERROR:?\s*/, "");
      } else if (/^ERROR:/.test(line) && error === "") error = line.replace(/^ERROR:\s*/, "");
      return this.progress();
    },
    progress() {
      const all = [...steps.values()];
      const total = Math.max(0, ...all.map((s) => s.of));
      return { done: all.filter((s) => s.done).length, total, status, error };
    },
  };
}

/** A path on this computer: absolute, without a NUL. */
export function hostPath(/** @type {unknown} */ value, /** @type {string} */ what = "The path") {
  if (typeof value !== "string" || !value.startsWith("/") || value.includes("\0"))
    throw new Error(`${what} ${JSON.stringify(value)} is not an absolute path on this computer.`);
  return value.replace(/\/+$/, "") || "/";
}

/**
 * `docker build`: the Dockerfile's folder is the context unless one is named, the tag checked as an
 * image reference, plain progress so every step is a line.
 * @param {{ dockerfile: unknown, tag?: unknown, context?: unknown, pull?: boolean, noCache?: boolean }} spec
 */
export function buildArgs(spec) {
  const file = hostPath(spec.dockerfile, "The Dockerfile");
  const folder = file.slice(0, file.lastIndexOf("/")) || "/";
  const context =
    spec.context === undefined || spec.context === ""
      ? folder
      : hostPath(spec.context, "The build context");
  const args = ["build", "--progress", "plain", "-f", file];
  if (spec.tag !== undefined && spec.tag !== "") args.push("-t", imageRef(spec.tag));
  if (spec.pull === true) args.push("--pull");
  if (spec.noCache === true) args.push("--no-cache");
  return { args: [...args, "--", context], cwd: context };
}
