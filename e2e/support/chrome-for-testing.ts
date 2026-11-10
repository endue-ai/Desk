// Chrome for Testing's builds for the app's Chromium (ADR 0144), pinned with their SHA-256 per platform
// in e2e/driver/chrome-for-testing.json, downloaded once into ~/.cache/desk/<build>/<version>/<platform>,
// checked and unpacked there. chromedriver attaches the app e2e to the CEF desk; chrome-headless-shell
// runs the runtime e2e (packages/runtime/e2e/chromium.ts). DESK_CHROMEDRIVER and DESK_E2E_CHROMIUM name
// a binary instead (a machine without the network, a newer local build).
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

/** The builds the manifest pins. */
export type Build = "chromedriver" | "chrome-headless-shell";

export interface Pin {
  version: string;
  sha256: string;
}

export interface Manifest {
  chromium: string;
  builds: Record<Build, Record<string, Pin>>;
}

const MANIFEST = fileURLToPath(new URL("../driver/chrome-for-testing.json", import.meta.url));
const STORE = "https://storage.googleapis.com/chrome-for-testing-public";
/** The variable that names a binary of each build instead of the pinned one. */
const OVERRIDE: Record<Build, string> = {
  chromedriver: "DESK_CHROMEDRIVER",
  "chrome-headless-shell": "DESK_E2E_CHROMIUM",
};

/** The pins in e2e/driver/chrome-for-testing.json. */
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
  throw new Error(`Chrome for Testing publishes no build for ${platform}-${arch}`);
}

export const downloadUrl = (build: Build, version: string, key: string) =>
  `${STORE}/${version}/${key}/${build}-${key}.zip`;

/** Where the unpacked archive keeps the binary. */
export const binaryPath = (build: Build, dir: string, key: string) =>
  join(dir, `${build}-${key}`, key.startsWith("win") ? `${build}.exe` : build);

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`chrome-for-testing: ${url} answered ${response.status}`);
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

/** Where `build`'s pinned binary for this platform is, or will be once fetched; its pin and folder. */
export function pinned(build: Build, options: EnsureOptions = {}) {
  const {
    cache = join(homedir(), ".cache", "desk", build),
    manifest = readManifest(),
    key = platformKey(),
  } = options;
  const pin = manifest.builds[build]?.[key];
  if (!pin) throw new Error(`${build}: e2e/driver/chrome-for-testing.json pins nothing for ${key}`);
  const dir = join(cache, pin.version, key);
  return { pin, key, cache, dir, binary: binaryPath(build, dir, key) };
}

/** `build`'s binary for this platform: its variable's, else the pinned one, fetched once. */
export async function ensureBuild(build: Build, options: EnsureOptions = {}): Promise<string> {
  const named = process.env[OVERRIDE[build]];
  if (!options.cache && named) return named;
  const { pin, key, cache, dir, binary } = pinned(build, options);
  if (existsSync(binary)) return binary;

  const { fetchZip = fetchBytes, unzip = unzipFile } = options;
  const url = downloadUrl(build, pin.version, key);
  const bytes = await fetchZip(url);
  const got = createHash("sha256").update(bytes).digest("hex");
  if (got !== pin.sha256) {
    throw new Error(`${build}: ${url} has SHA-256 ${got}, not the pinned ${pin.sha256}`);
  }
  // Unpack beside the cache and move it in whole, so a broken unpack never looks like a binary.
  mkdirSync(join(cache, pin.version), { recursive: true });
  const work = mkdtempSync(join(cache, pin.version, `.${key}-`));
  try {
    const zip = join(work, `${build}-${key}.zip`);
    writeFileSync(zip, bytes);
    const unpacked = join(work, "unpacked");
    mkdirSync(unpacked);
    await unzip(zip, unpacked);
    if (!existsSync(binaryPath(build, unpacked, key))) {
      throw new Error(`${build}: ${url} holds no ${binaryPath(build, "", key)}`);
    }
    rmSync(dir, { recursive: true, force: true });
    renameSync(unpacked, dir);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return binary;
}

/** The chromedriver binary for this platform. */
export const ensureChromedriver = (options: EnsureOptions = {}) =>
  ensureBuild("chromedriver", options);

/** The headless shell the runtime e2e runs on, fetched once. */
export const ensureHeadlessShell = (options: EnsureOptions = {}) =>
  ensureBuild("chrome-headless-shell", options);

/** Where the runtime e2e's headless shell is (DESK_E2E_CHROMIUM, else the pinned one's place). */
export function headlessShellPath(): string {
  return process.env.DESK_E2E_CHROMIUM || pinned("chrome-headless-shell").binary;
}
