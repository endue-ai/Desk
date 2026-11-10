// The chromedriver the app e2e attaches to the CEF desk with (ADR 0144): Chrome for Testing's build for
// the app's Chromium, pinned with its SHA-256 per platform in e2e/driver/chromedriver.json, downloaded
// once into ~/.cache/desk/chromedriver/<version>/<platform>, checked and unpacked there.
// DESK_CHROMEDRIVER names a binary instead (a machine without the network, a newer local build).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Pin {
  version: string;
  sha256: string;
}

export interface Manifest {
  chromium: string;
  downloads: Record<string, Pin>;
}

const MANIFEST = fileURLToPath(new URL("../driver/chromedriver.json", import.meta.url));
const STORE = "https://storage.googleapis.com/chrome-for-testing-public";

/** The pins in e2e/driver/chromedriver.json. */
export function readManifest(file = MANIFEST): Manifest {
  return JSON.parse(readFileSync(file, "utf8")) as Manifest;
}

/** Chrome for Testing's name for this platform. */
export function platformKey(platform = process.platform, arch = process.arch): string {
  const key = { darwin: { arm64: "mac-arm64", x64: "mac-x64" }, linux: { x64: "linux64" } }[
    platform as "darwin" | "linux"
  ]?.[arch as "arm64" | "x64"];
  if (key) return key;
  if (platform === "win32" && arch === "x64") return "win64";
  throw new Error(`Chrome for Testing publishes no chromedriver for ${platform}-${arch}`);
}

export const downloadUrl = (version: string, key: string) =>
  `${STORE}/${version}/${key}/chromedriver-${key}.zip`;

/** Where the unpacked archive keeps the binary. */
export const binaryPath = (dir: string, key: string) =>
  join(dir, `chromedriver-${key}`, key.startsWith("win") ? "chromedriver.exe" : "chromedriver");

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`chromedriver: ${url} answered ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** `unzip` on macOS and Linux; Windows 10's tar reads zip files. */
async function unzipFile(file: string, into: string): Promise<void> {
  if (process.platform === "win32") execFileSync("tar", ["-xf", file, "-C", into]);
  else execFileSync("unzip", ["-q", "-o", file, "-d", into]);
}

export interface EnsureOptions {
  cache?: string;
  manifest?: Manifest;
  key?: string;
  fetchZip?: (url: string) => Promise<Uint8Array>;
  unzip?: (file: string, into: string) => Promise<void>;
}

/** The chromedriver binary for this platform: DESK_CHROMEDRIVER, else the pinned one, fetched once. */
export async function ensureChromedriver(options: EnsureOptions = {}): Promise<string> {
  if (!options.cache && process.env.DESK_CHROMEDRIVER) return process.env.DESK_CHROMEDRIVER;
  const {
    cache = join(homedir(), ".cache", "desk", "chromedriver"),
    manifest = readManifest(),
    key = platformKey(),
    fetchZip = fetchBytes,
    unzip = unzipFile,
  } = options;
  const pin = manifest.downloads[key];
  if (!pin) throw new Error(`chromedriver: e2e/driver/chromedriver.json pins nothing for ${key}`);
  const dir = join(cache, pin.version, key);
  const binary = binaryPath(dir, key);
  if (existsSync(binary)) return binary;

  const url = downloadUrl(pin.version, key);
  const bytes = await fetchZip(url);
  const got = createHash("sha256").update(bytes).digest("hex");
  if (got !== pin.sha256) {
    throw new Error(`chromedriver: ${url} has SHA-256 ${got}, not the pinned ${pin.sha256}`);
  }
  // Unpack beside the cache and move it in whole, so a broken unpack never looks like a binary.
  mkdirSync(join(cache, pin.version), { recursive: true });
  const work = mkdtempSync(join(cache, pin.version, `.${key}-`));
  try {
    const zip = join(work, `chromedriver-${key}.zip`);
    writeFileSync(zip, bytes);
    const unpacked = join(work, "unpacked");
    mkdirSync(unpacked);
    await unzip(zip, unpacked);
    if (!existsSync(binaryPath(unpacked, key))) {
      throw new Error(`chromedriver: ${url} holds no ${binaryPath("", key)}`);
    }
    rmSync(dir, { recursive: true, force: true });
    renameSync(unpacked, dir);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return binary;
}
