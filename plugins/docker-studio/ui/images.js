// Images without DOM: an image's layers from `image history`, a pull's or a push's progress from
// docker's plain output (per layer: waiting, downloading done/total, extracting, complete), and
// the arguments of `docker run` from the Run form, every part checked. Pure.

import { stripAnsi } from "./errors.js";
import { parseSize } from "./format.js";
import { jsonLines } from "./parse.js";
import { envSpecs, imageRef, objectRef, portSpec, restartPolicy, volumeSpec } from "./refs.js";

/**
 * @typedef {{ id: string, created: number, by: string, size: number, empty: boolean, comment: string }} Layer
 * @typedef {{ id: string, status: string, done: number, total: number }} LayerProgress
 * @typedef {{ image: string, name: string, ports: Array<{ host: string, container: string, proto: string }>,
 *   volumes: Array<{ source: string, target: string, readOnly: boolean }>,
 *   env: Array<{ key: string, value: string }>, restart: string, network: string, command: string,
 *   remove: boolean, interactive: boolean }} RunForm
 */

export const historyArgs = (/** @type {string} */ ref) => [
  "image",
  "history",
  "--no-trunc",
  "--format",
  "{{json .}}",
  "--",
  imageRef(ref),
];

/** The layers, oldest first (the order they are built in), instructions without the shell's noise. */
export function parseHistory(/** @type {string} */ stdout) {
  return jsonLines(stdout)
    .map(
      (r) =>
        /** @type {Layer} */ ({
          id: String(r.ID ?? "") === "<missing>" ? "" : String(r.ID ?? ""),
          created: Date.parse(String(r.CreatedAt ?? "")) || 0,
          by: String(r.CreatedBy ?? "")
            .replace(/^\/bin\/sh -c #\(nop\)\s*/, "")
            .replace(/^\/bin\/sh -c /, "RUN ")
            .replace(/^RUN \/bin\/sh -c /, "RUN ")
            .replace(/\s*# buildkit$/, "")
            .replace(/\s+/g, " ")
            .trim(),
          size: parseSize(String(r.Size ?? "0B")) || 0,
          empty: (parseSize(String(r.Size ?? "0B")) || 0) === 0,
          comment: String(r.Comment ?? ""),
        }),
    )
    .reverse();
}

/** The instruction a layer was made by: RUN, COPY, ENV, … */
export function verbOf(/** @type {string} */ by) {
  const word = /^([A-Z]+)\b/.exec(by)?.[1];
  return word ?? (by.startsWith("|") ? "RUN" : "");
}

const PROGRESS = /^([0-9a-f]{12}): (.+)$/;
const AMOUNT = /([\d.]+\s*[kKMGT]?i?B)\s*\/\s*([\d.]+\s*[kKMGT]?i?B)/;

/**
 * Read one line of a pull or push into the layers' progress; returns what the line said about
 * the whole (a digest, a status) when it was not about a layer.
 * @param {Map<string, LayerProgress>} layers @param {string} raw
 */
export function progressLine(layers, raw) {
  const line = stripAnsi(raw).trim();
  const found = PROGRESS.exec(line);
  if (!found) return line;
  const id = found[1] ?? "";
  const rest = found[2] ?? "";
  const layer = layers.get(id) ?? { id, status: "", done: 0, total: 0 };
  const amount = AMOUNT.exec(rest);
  if (amount) {
    layer.done = parseSize(amount[1]) || 0;
    layer.total = parseSize(amount[2]) || layer.total;
  }
  layer.status = rest
    .replace(/\s*\[[=> ]*\]\s*/, " ")
    .replace(AMOUNT, "")
    .trim();
  if (/complete|already exists|pushed|layer already exists|mounted from/i.test(rest) && layer.total)
    layer.done = layer.total;
  layers.set(id, layer);
  return "";
}

/** How far a pull is, 0 to 1, from the layers that said their size; done ones count whole. */
export function progressOf(/** @type {Map<string, LayerProgress>} */ layers) {
  let done = 0;
  let total = 0;
  let finished = 0;
  for (const l of layers.values()) {
    if (/complete|exists|pushed/i.test(l.status)) finished += 1;
    if (l.total) {
      total += l.total;
      done += /complete|exists|pushed/i.test(l.status) ? l.total : Math.min(l.done, l.total);
    }
  }
  if (layers.size === 0) return 0;
  const bytes = total ? done / total : 0;
  return Math.max(bytes, finished / layers.size);
}

/** An empty Run form for an image, with its exposed ports published on the same numbers. */
export function formFor(/** @type {string} */ ref, /** @type {string[]} */ exposed = []) {
  /** @type {RunForm} */
  return {
    image: ref,
    name: "",
    ports: exposed.map((e) => {
      const [port = "", proto = "tcp"] = e.split("/");
      return { host: port, container: port, proto };
    }),
    volumes: [],
    env: [],
    restart: "no",
    network: "",
    command: "",
    remove: false,
    interactive: false,
  };
}

/** A command line split into words, "quotes" and 'quotes' kept together, without a shell. */
export function words(/** @type {string} */ text) {
  /** @type {string[]} */
  const out = [];
  for (const match of text.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g))
    out.push(
      match[1] !== undefined ? match[1].replace(/\\(.)/g, "$1") : (match[2] ?? match[3] ?? ""),
    );
  return out;
}

/** The arguments of `docker run --detach` for a form: options, `--`, the image, its command. */
export function runArgs(/** @type {RunForm} */ form) {
  const args = ["run", "--detach"];
  if (form.name.trim()) args.push("--name", objectRef(form.name.trim(), "The container name"));
  for (const p of form.ports) {
    if (!p.container.trim()) continue;
    const spec = `${p.host.trim() ? `${p.host.trim()}:` : ""}${p.container.trim()}${p.proto && p.proto !== "tcp" ? `/${p.proto}` : ""}`;
    args.push("--publish", portSpec(spec));
  }
  for (const v of form.volumes) {
    if (!v.target.trim()) continue;
    const spec = v.source.trim()
      ? `${v.source.trim()}:${v.target.trim()}${v.readOnly ? ":ro" : ""}`
      : v.target.trim();
    args.push("--volume", volumeSpec(spec));
  }
  for (const e of envSpecs(
    form.env.filter((x) => x.key.trim()).map((x) => `${x.key.trim()}=${x.value}`),
  ))
    args.push("--env", e);
  if (form.restart && form.restart !== "no") args.push("--restart", restartPolicy(form.restart));
  if (form.network) args.push("--network", objectRef(form.network, "The network"));
  if (form.remove) args.push("--rm");
  if (form.interactive) args.push("--interactive", "--tty");
  return [...args, "--", imageRef(form.image), ...words(form.command)];
}

/** The command a person would type for these args, quoted where a shell would need it. */
export function shellLine(/** @type {string[]} */ args) {
  const quote = (/** @type {string} */ a) =>
    /^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`;
  return ["docker", ...args.filter((a) => a !== "--")].map(quote).join(" ");
}
