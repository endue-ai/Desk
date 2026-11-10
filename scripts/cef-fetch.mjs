#!/usr/bin/env node
// Fetch the CEF build the desk ships (#46): the exact archive apps/desk/shell/packager/cef.json pins
// for a target, refused unless its size, SHA-256 and the CDN's SHA-1 all match, then unpacked into the
// layout the cef-dll-sys build script reads from CEF_PATH (`<out>/<cef version>/cef_<os>_<arch>`, with
// its archive.json), so cargo never downloads CEF itself. The archive stays beside it as the cache: a
// later run checks its hashes again and unpacks only when the folder is missing or from another
// archive. `--dry-run` prints what it would fetch and where, and fetches nothing.
//   node scripts/cef-fetch.mjs --target <rust triple> [--out <dir>] [--dry-run]
// Prints the folder to export as CEF_PATH (`--out`, else $CEF_PATH, else ~/.cache/desk/cef).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
export const PIN = join(ROOT, "apps/desk/shell/packager/cef.json");
const MARK = ".desk-sha256";

/** The pin, with every target's archive checked for the fields a fetch needs. */
export function readPin(path = PIN) {
  const pin = JSON.parse(readFileSync(path, "utf8"));
  if (typeof pin.version !== "string" || !pin.version.includes("+")) {
    throw new Error(`${path}: version must be the full CEF version (156.0.26+g…+chromium-…)`);
  }
  for (const [target, archive] of Object.entries(pin.archives ?? {})) {
    const ok =
      typeof archive.name === "string" &&
      archive.name.startsWith(`cef_binary_${pin.version}_`) &&
      Number.isInteger(archive.size) &&
      /^[0-9a-f]{40}$/u.test(archive.sha1) &&
      /^[0-9a-f]{64}$/u.test(archive.sha256);
    if (!ok)
      throw new Error(`${path}: the archive for ${target} needs name, size, sha1 and sha256`);
  }
  return pin;
}

/** "156.0.26": the folder name cef-dll-sys looks for under CEF_PATH. */
export const cefVersion = (pin) => pin.version.split("+")[0];

/** The CEF version the cef crate in Cargo.lock wraps: its build metadata ("156.4.0+156.0.26"). */
export function crateCefVersion(lock) {
  const m = /\[\[package\]\]\nname = "cef"\nversion = "[^"+]+\+([^"]+)"/u.exec(lock);
  if (!m) throw new Error("Cargo.lock has no cef package with a CEF build in its version");
  return m[1];
}

const OS_ARCH = {
  "aarch64-apple-darwin": ["macos", "aarch64"],
  "x86_64-apple-darwin": ["macos", "x86_64"],
  "x86_64-pc-windows-msvc": ["windows", "x86_64"],
  "aarch64-pc-windows-msvc": ["windows", "aarch64"],
  "x86_64-unknown-linux-gnu": ["linux", "x86_64"],
  "aarch64-unknown-linux-gnu": ["linux", "aarch64"],
};

/** Where a target's archive comes from and lands, as cef-dll-sys names its folders. */
export function plan(pin, target, out) {
  const archive = pin.archives[target];
  const osArch = OS_ARCH[target];
  if (!archive || !osArch) throw new Error(`cef.json pins no CEF archive for ${target}`);
  const base = join(out, cefVersion(pin));
  return {
    archive,
    os: osArch[0],
    url: `${pin.cdn.replace(/\/+$/u, "")}/${archive.name}`,
    file: join(base, archive.name),
    dir: join(base, `cef_${osArch[0]}_${osArch[1]}`),
  };
}

/** Size and both hashes of what `chunks` yields. */
async function measure(chunks) {
  const sha1 = createHash("sha1");
  const sha256 = createHash("sha256");
  let size = 0;
  for await (const chunk of chunks) {
    sha1.update(chunk);
    sha256.update(chunk);
    size += chunk.length;
  }
  return { size, sha1: sha1.digest("hex"), sha256: sha256.digest("hex") };
}

export const measureFile = (path) => measure(createReadStream(path));

/** Throws unless `got` is the pinned archive. */
export function check(got, archive) {
  for (const field of ["size", "sha256", "sha1"]) {
    if (got[field] !== archive[field]) {
      throw new Error(`${archive.name}: ${field} is ${got[field]}, the pin says ${archive[field]}`);
    }
  }
}

/** Download `url` to `file` through a .part file, kept only when it is the pinned archive. */
async function download(url, file, archive, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const part = `${file}.part`;
  mkdirSync(resolve(file, ".."), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(part));
  try {
    check(await measureFile(part), archive);
  } catch (error) {
    rmSync(part, { force: true });
    throw error;
  }
  renameSync(part, file);
}

/** Unpack `p.file` into `p.dir` the way download-cef lays it out, plus CEF's LICENSE.txt. */
function unpack(p) {
  const base = resolve(p.file, "..");
  const stem = join(base, p.archive.name.replace(/\.tar\.bz2$/u, ""));
  rmSync(stem, { recursive: true, force: true });
  rmSync(p.dir, { recursive: true, force: true });
  // A relative name: GNU tar on Windows reads "C:" as a remote host.
  const tar = spawnSync("tar", ["-xjf", p.archive.name], { cwd: base, stdio: "inherit" });
  if (tar.status !== 0) throw new Error(`tar could not unpack ${p.archive.name}`);
  renameSync(join(stem, "Release"), p.dir);
  if (p.os !== "macos") {
    for (const name of readdirSync(join(stem, "Resources"))) {
      renameSync(join(stem, "Resources", name), join(p.dir, name));
    }
  }
  for (const name of [
    "CMakeLists.txt",
    "cmake",
    "include",
    "libcef_dll",
    "CREDITS.html",
    "LICENSE.txt",
  ]) {
    renameSync(join(stem, name), join(p.dir, name));
  }
  rmSync(stem, { recursive: true, force: true });
  const { name, sha1 } = p.archive;
  writeFileSync(
    join(p.dir, "archive.json"),
    JSON.stringify({ type: "minimal", name, sha1 }, null, 2),
  );
  writeFileSync(join(p.dir, MARK), `${p.archive.sha256}\n`);
}

/** The folder already holds this archive's files. */
const unpacked = (p) =>
  existsSync(join(p.dir, MARK)) &&
  readFileSync(join(p.dir, MARK), "utf8").trim() === p.archive.sha256;

/** Make sure `out` holds the pinned CEF for `target`; answers its folder. */
export async function fetchCef({
  target,
  out,
  pin = readPin(),
  fetchImpl = fetch,
  log = () => {},
}) {
  const p = plan(pin, target, out);
  let fresh = false;
  if (existsSync(p.file)) {
    try {
      check(await measureFile(p.file), p.archive);
    } catch (error) {
      log(`cef-fetch: ${error.message}; fetching it again`);
      rmSync(p.file);
    }
  }
  if (!existsSync(p.file)) {
    log(`cef-fetch: ${p.url}`);
    await download(p.url, p.file, p.archive, fetchImpl);
    fresh = true;
  }
  if (fresh || !unpacked(p)) {
    log(`cef-fetch: unpacking into ${p.dir}`);
    unpack(p);
  }
  return p.dir;
}

function parseArgs(args) {
  const value = (name) => {
    const at = args.indexOf(name);
    return at < 0 ? undefined : args[at + 1];
  };
  const target = value("--target");
  if (!target) throw new Error("--target <rust triple> is missing");
  const out = resolve(value("--out") ?? process.env.CEF_PATH ?? join(homedir(), ".cache/desk/cef"));
  return { target, out, dryRun: args.includes("--dry-run") };
}

async function main(args) {
  const { target, out, dryRun } = parseArgs(args);
  if (dryRun) {
    const p = plan(readPin(), target, out);
    const { size, sha256 } = p.archive;
    console.log(`cef-fetch: would fetch ${p.url} (${size} bytes, sha256 ${sha256})`);
    console.log(`cef-fetch: into ${p.dir}`);
    console.log(out);
    return;
  }
  await fetchCef({ target, out, log: (line) => console.error(line) });
  console.log(out);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`cef-fetch: ${error.message}`);
    process.exit(1);
  });
}
