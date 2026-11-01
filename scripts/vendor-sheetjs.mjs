// Copies the sheets plugin's parser, SheetJS Community Edition, from its release tarball into
// plugins/sheets/ui/vendor, with its licence and a VERSIONS file that records every file's SHA-256
// (ADR 0043). SheetJS no longer publishes to npm, so the tarball comes from its own CDN and is
// pinned by hash. `node scripts/vendor-sheetjs.mjs` runs it; its test checks the committed copy
// against VERSIONS without the network.
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const VENDOR = join(ROOT, "plugins/sheets/ui/vendor");

export const VERSION = "0.20.3";
export const TARBALL = `https://cdn.sheetjs.com/xlsx-${VERSION}/xlsx-${VERSION}.tgz`;
export const TARBALL_SHA256 = "8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8";

/** The files ui/vendor holds, by name, and where each one is in the tarball. */
export const FILES = {
  "xlsx.mjs": "package/xlsx.mjs",
  "cpexcel.full.mjs": "package/dist/cpexcel.full.mjs",
  LICENSE: "package/LICENSE",
};

export const sha256 = (/** @type {Uint8Array | string} */ data) =>
  createHash("sha256").update(data).digest("hex");

/** The source map comment goes: the maps are not vendored, so it would only point at a 404. */
export function strip(/** @type {string} */ text) {
  return text.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/u, "\n");
}

/**
 * The regular files of a tar archive, by path. Enough of ustar for npm tarballs: 512-byte headers,
 * the name and its prefix, the octal size, and pax or GNU long names skipped with their data.
 * @param {Uint8Array} tar
 * @returns {Map<string, Uint8Array>}
 */
export function untar(tar) {
  const files = new Map();
  const text = (/** @type {number} */ at, /** @type {number} */ length) => {
    const bytes = tar.subarray(at, at + length);
    const end = bytes.indexOf(0);
    return new TextDecoder().decode(end < 0 ? bytes : bytes.subarray(0, end));
  };
  let at = 0;
  while (at + 512 <= tar.length) {
    const name = text(at, 100);
    if (name === "") break;
    const size = Number.parseInt(text(at + 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(tar[at + 156] ?? 0);
    const prefix = text(at + 345, 155);
    const path = prefix ? `${prefix}/${name}` : name;
    const start = at + 512;
    if (type === "0" || type === "\0") files.set(path, tar.slice(start, start + size));
    at = start + Math.ceil(size / 512) * 512;
  }
  return files;
}

/**
 * What ui/vendor must hold, from the tarball's bytes: file name -> text. Refuses a tarball whose
 * hash is not the pinned one.
 * @param {Uint8Array} tarball
 */
export function expected(tarball) {
  const actual = sha256(tarball);
  if (actual !== TARBALL_SHA256) {
    throw new Error(`${TARBALL} has SHA-256 ${actual}, expected ${TARBALL_SHA256}`);
  }
  const entries = untar(gunzipSync(tarball));
  /** @type {Record<string, string>} */
  const files = {};
  for (const [target, source] of Object.entries(FILES)) {
    const bytes = entries.get(source);
    if (!bytes) throw new Error(`${source} is missing from ${TARBALL}`);
    const text = new TextDecoder().decode(bytes);
    files[target] = target.endsWith(".mjs") ? strip(text) : text;
  }
  files.VERSIONS = versions(files);
  return files;
}

/** The VERSIONS file: the release and its tarball, then each vendored file and its SHA-256. */
export function versions(/** @type {Record<string, string>} */ files) {
  const lines = [`xlsx ${VERSION} ${TARBALL} sha256:${TARBALL_SHA256}`];
  for (const name of Object.keys(FILES)) lines.push(`${name} sha256:${sha256(files[name] ?? "")}`);
  return `${lines.join("\n")}\n`;
}

/** The hashes VERSIONS records, by file name. */
export function recorded(/** @type {string} */ text) {
  /** @type {Record<string, string>} */
  const hashes = {};
  for (const line of text.split("\n").slice(1)) {
    const match = /^(\S+) sha256:([0-9a-f]{64})$/u.exec(line);
    if (match?.[1] && match[2]) hashes[match[1]] = match[2];
  }
  return hashes;
}

export async function vendor() {
  const response = await fetch(TARBALL);
  if (!response.ok) throw new Error(`${TARBALL}: HTTP ${response.status}`);
  const files = expected(new Uint8Array(await response.arrayBuffer()));
  mkdirSync(VENDOR, { recursive: true });
  for (const name of readdirSync(VENDOR)) if (!(name in files)) rmSync(join(VENDOR, name));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(VENDOR, name), text);
  return Object.keys(files).sort();
}

/** The committed copy, file name -> text. */
export const committed = () =>
  Object.fromEntries(readdirSync(VENDOR).map((n) => [n, readFileSync(join(VENDOR, n), "utf8")]));

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const name of await vendor()) console.log(`vendored ${name}`);
}
