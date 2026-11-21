// Copies the database plugin's SQL parser, PostgreSQL's own grammar through libpg_query built to
// WebAssembly, from the npm package libpg-query's registry tarball into plugins/database/ui/vendor,
// with the licences of the wrapper (MIT), libpg_query (BSD-3-Clause) and PostgreSQL, and a VERSIONS
// file that records every file's SHA-256 (ADR 0283). The tarball and the two licence files are pinned
// by hash. The Emscripten glue becomes an ES module that never takes Node's paths, so a module worker
// imports it as it is. `node scripts/vendor-libpg-query.mjs` runs it; its test checks the committed
// copy against VERSIONS without the network.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { ROOT, sha256, untar } from "./vendor-sheetjs.mjs";

export const VENDOR = join(ROOT, "plugins/database/ui/vendor");

export const PACKAGE = "libpg-query";
export const VERSION = "18.2.4";
export const TARBALL = `https://registry.npmjs.org/${PACKAGE}/-/${PACKAGE}-${VERSION}.tgz`;
export const TARBALL_SHA256 = "4dcb26601117a425d645cf8a053819cf64f73b10347b2f5db1488e40b477c785";

/** The libpg_query commit the package was built from (its package.json says so), and its licences. */
export const LIBPG_QUERY = "https://github.com/constructive-io/libpg_query";
export const COMMIT = "b0f5f331dc50d69597ec610de7b21afa47a66808";
const RAW = `https://raw.githubusercontent.com/constructive-io/libpg_query/${COMMIT}`;
export const LICENCES = {
  "LICENSE.libpg_query": {
    url: `${RAW}/LICENSE`,
    sha256: "f9352c20940619a380a5e9f23cebe34d8f797cfbd747fc236a7a3e5fc8ef9b41",
  },
  "COPYRIGHT.postgresql": {
    url: `${RAW}/src/postgres/COPYRIGHT`,
    sha256: "3d6af92ff8a4c2cdf69afb1cf44edea727922f5cd0cf8b5f72b11cdecac8fdfd",
  },
};

/** The files ui/vendor holds from the tarball, by name, and where each one is in it. */
export const FILES = {
  "libpg-query.mjs": "package/wasm/libpg-query.js",
  "libpg-query.wasm": "package/wasm/libpg-query.wasm",
  LICENSE: "package/LICENSE",
};

/** Every file ui/vendor holds, VERSIONS aside, in the order VERSIONS lists them. */
export const NAMES = [...Object.keys(FILES), ...Object.keys(LICENCES)];

const NODE_TEST =
  'var ENVIRONMENT_IS_NODE=globalThis.process?.versions?.node&&globalThis.process?.type!="renderer";';
const EXPORTS =
  /;if\(typeof exports==="object"&&typeof module==="object"\)\{module\.exports=PgQueryModule;module\.exports\.default=PgQueryModule\}else if\(typeof define==="function"&&define\["amd"\]\)define\(\[\],\(\)=>PgQueryModule\);\s*$/u;

/**
 * The glue as an ES module: its CommonJS and AMD export becomes `export default`, and it never takes
 * Node's paths (`require`, `__dirname`), which a browser worker does not have. Refuses glue whose
 * shape changed, so an update cannot slip past either edit.
 * @param {string} glue
 */
export function esm(glue) {
  if (glue.split(NODE_TEST).length !== 2) throw new Error("the glue's Node test changed");
  if (!EXPORTS.test(glue)) throw new Error("the glue's CommonJS export changed");
  return glue
    .replace(NODE_TEST, "var ENVIRONMENT_IS_NODE=false;")
    .replace(EXPORTS, ";export default PgQueryModule;\n");
}

/**
 * What ui/vendor must hold, from the tarball's bytes and the licence files': file name -> bytes or
 * text. Refuses anything whose hash is not the pinned one, and a package built from another commit.
 * @param {Uint8Array} tarball
 * @param {Record<string, Uint8Array>} licences by file name
 */
export function expected(tarball, licences) {
  const actual = sha256(tarball);
  if (actual !== TARBALL_SHA256) {
    throw new Error(`${TARBALL} has SHA-256 ${actual}, expected ${TARBALL_SHA256}`);
  }
  const entries = untar(gunzipSync(tarball));
  const meta = JSON.parse(new TextDecoder().decode(entries.get("package/package.json")));
  if (meta["x-publish"]?.libpgQueryCommit !== COMMIT) {
    throw new Error(`${PACKAGE} ${VERSION} was built from another libpg_query commit`);
  }
  /** @type {Record<string, Uint8Array | string>} */
  const files = {};
  for (const [target, source] of Object.entries(FILES)) {
    const bytes = entries.get(source);
    if (!bytes) throw new Error(`${source} is missing from ${TARBALL}`);
    const recorded = meta["x-publish"]?.wasmSha256?.[source.replace(/^package\//u, "")];
    if (recorded && recorded !== sha256(bytes))
      throw new Error(`${source} differs from its record`);
    files[target] = target.endsWith(".wasm")
      ? bytes
      : target.endsWith(".mjs")
        ? esm(new TextDecoder().decode(bytes))
        : new TextDecoder().decode(bytes);
  }
  for (const [name, { url, sha256: pinned }] of Object.entries(LICENCES)) {
    const bytes = licences[name];
    if (!bytes || sha256(bytes) !== pinned) throw new Error(`${url} is not the pinned file`);
    files[name] = new TextDecoder().decode(bytes);
  }
  files.VERSIONS = versions(files);
  return files;
}

/** VERSIONS: the package and its tarball, the libpg_query commit, then each file and its SHA-256. */
export function versions(/** @type {Record<string, Uint8Array | string>} */ files) {
  const lines = [
    `${PACKAGE} ${VERSION} ${TARBALL} sha256:${TARBALL_SHA256}`,
    `libpg_query ${COMMIT} ${LIBPG_QUERY}`,
  ];
  for (const name of NAMES) lines.push(`${name} sha256:${sha256(files[name] ?? "")}`);
  return `${lines.join("\n")}\n`;
}

/** The hashes VERSIONS records, by file name. */
export function recorded(/** @type {string} */ text) {
  /** @type {Record<string, string>} */
  const hashes = {};
  for (const line of text.split("\n").slice(2)) {
    const match = /^(\S+) sha256:([0-9a-f]{64})$/u.exec(line);
    if (match?.[1] && match[2]) hashes[match[1]] = match[2];
  }
  return hashes;
}

async function download(/** @type {string} */ url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function vendor() {
  const tarball = await download(TARBALL);
  /** @type {Record<string, Uint8Array>} */
  const licences = {};
  for (const [name, { url }] of Object.entries(LICENCES)) licences[name] = await download(url);
  const files = expected(tarball, licences);
  mkdirSync(VENDOR, { recursive: true });
  // Its own files only: another library's folder (ui/vendor/editor, ADR 0282) sits beside them.
  for (const name of ownFiles()) if (!(name in files)) rmSync(join(VENDOR, name));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(VENDOR, name), content);
  return Object.keys(files).sort();
}

/** The files directly in ui/vendor, which are the parser's; folders hold other libraries. */
const ownFiles = () =>
  readdirSync(VENDOR, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

/** The committed copy, file name -> bytes. */
export const committed = () =>
  Object.fromEntries(ownFiles().map((n) => [n, new Uint8Array(readFileSync(join(VENDOR, n)))]));

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const name of await vendor()) console.log(`vendored ${name}`);
}
