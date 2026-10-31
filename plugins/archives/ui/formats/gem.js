// Ruby gems: a plain tar holding metadata.gz (the Gem::Specification as YAML, shown as details)
// and data.tar.gz (the gem's files).
import { text } from "../bytes.js";
import { decode, decodedInput } from "../codecs/index.js";
import { sliceSource } from "../source.js";
import { row } from "./archive.js";
import { openTar, openTarIn } from "./tar.js";

/** @typedef {import("../source.js").Source} Source */
/** @typedef {import("./archive.js").Archive} Archive */
/** @typedef {import("./streamed.js").Placed} Placed */

/** A YAML scalar as written by Psych: plain, 'single' or "double" quoted. @param {string} raw */
function scalar(raw) {
  const s = raw.trim();
  if (s.startsWith("'") && s.endsWith("'") && s.length > 1)
    return s.slice(1, -1).replace(/''/g, "'");
  if (s.startsWith('"') && s.endsWith('"') && s.length > 1)
    return s
      .slice(1, -1)
      .replace(/\\(["\\nt])/g, (_m, c) => (c === "n" ? "\n" : c === "t" ? "\t" : c));
  return s;
}

/**
 * The top-level fields of a gem's specification: a value on the key's line, a list of "- item"
 * lines below it, or (for version) the nested `version:` under a Gem::Version.
 * @param {string} yaml
 */
export function gemFields(yaml) {
  /** @type {Record<string, string | string[]>} */
  const fields = {};
  const lines = yaml.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z_][\w-]*):(?:\s(.*))?$/.exec(lines[i] ?? "");
    if (!m) continue;
    const key = m[1] ?? "";
    const value = (m[2] ?? "").trim();
    if (value.startsWith("!ruby/object:Gem::Version")) {
      const nested = /^\s+version:\s*(.*)$/.exec(lines[i + 1] ?? "");
      if (nested) fields[key] = scalar(nested[1] ?? "");
    } else if (value === "") {
      /** @type {string[]} */
      const items = [];
      while (/^-\s/.test(lines[i + 1] ?? "")) items.push(scalar((lines[++i] ?? "").slice(2)));
      if (items.length) fields[key] = items;
    } else if (!value.startsWith("!") && value !== "[]" && value !== "{}")
      fields[key] = scalar(value);
  }
  return fields;
}

/** @param {Source} source @param {string} name @returns {Promise<Archive>} */
export async function openGem(source, name) {
  const outer = await openTar(source, name, { label: "tar" });
  const find = (/** @type {string} */ path) =>
    /** @type {Placed | undefined} */ (outer.entries.find((e) => e.path === path));
  const metadata = find("metadata.gz") ?? find("metadata");
  const data = find("data.tar.gz") ?? find("data.tar");
  if (!data) throw new Error(`${name} is a tar without a gem's data.tar.gz.`);
  /** @type {Array<{ label: string, value: string }>} */
  const details = [];
  if (metadata) {
    const raw = await outer.read(metadata);
    const fields = gemFields(text(metadata.path.endsWith(".gz") ? await decode("gzip", raw) : raw));
    const join = (/** @type {string | string[] | undefined} */ v) =>
      Array.isArray(v) ? v.join(", ") : v;
    for (const [label, value] of /** @type {Array<[string, string | string[] | undefined]>} */ ([
      ["Name", fields.name],
      ["Version", fields.version],
      ["Platform", fields.platform],
      ["Summary", fields.summary],
      ["Authors", fields.authors],
      ["License", fields.licenses ?? fields.license],
      ["Homepage", fields.homepage],
    ]))
      if (join(value)) details.push(row(label, join(value)));
  }
  const format = "Ruby gem";
  const slice = sliceSource(source, data.start, data.size);
  const files = data.path.endsWith(".gz")
    ? await openTarIn(() => decodedInput("gzip", slice), format)
    : await openTar(slice, data.path, { label: format });
  return { ...files, format, details };
}
