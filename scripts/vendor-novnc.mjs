// Copies the Screen Sharing plugin's VNC client, noVNC's core library and the pako files it imports,
// from the npm package the lockfile pins into plugins/screens/ui/vendor/novnc, keeping the package's
// own layout so its relative imports still resolve, with its licences and a VERSIONS file (ADR 0133).
// `just vendor-novnc` runs it; its test checks the committed copy matches, like vendor-xterm.
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PLUGIN = join(ROOT, "plugins/screens");
export const VENDOR = join(PLUGIN, "ui/vendor/novnc");
export const PACKAGE = "@novnc/novnc";

/** The folders copied whole (their .js files), and the single files beside them. */
export const FOLDERS = ["core", "vendor/pako/lib"];
export const FILES = ["LICENSE.txt", "AUTHORS", "docs/LICENSE.MPL-2.0", "vendor/pako/LICENSE"];

const require = createRequire(join(PLUGIN, "package.json"));

/** The package's folder: its one export is core/rfb.js, so package.json is found from there. */
export function packageDir() {
  return dirname(dirname(require.resolve(PACKAGE)));
}

/** The installed version of noVNC. */
export function version() {
  return JSON.parse(readFileSync(join(packageDir(), "package.json"), "utf8")).version;
}

/** Every file under `dir`, as paths relative to `base`, sorted. */
function walk(dir, base) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path, base) : [relative(base, path)];
    });
}

/** What ui/vendor/novnc must hold: relative path -> text. */
export function expected() {
  const from = packageDir();
  const files = {};
  for (const folder of FOLDERS) {
    for (const path of walk(join(from, folder), from).filter((p) => p.endsWith(".js"))) {
      files[path] = readFileSync(join(from, path), "utf8");
    }
  }
  for (const path of FILES) files[path] = readFileSync(join(from, path), "utf8");
  files.VERSIONS = `${PACKAGE} ${version()}\n`;
  return files;
}

/** The files the committed copy holds now, relative to ui/vendor/novnc. */
export function committed() {
  return walk(VENDOR, VENDOR);
}

export function vendor() {
  rmSync(VENDOR, { recursive: true, force: true });
  const files = expected();
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(VENDOR, path)), { recursive: true });
    writeFileSync(join(VENDOR, path), text);
  }
  return Object.keys(files).sort();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const name of vendor()) console.log(`vendored ${name}`);
}
