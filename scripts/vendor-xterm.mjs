// Copies the terminal plugin's emulator, xterm.js and its addons, from the npm packages the lockfile
// pins into plugins/terminal/ui/vendor, with their licences and a VERSIONS file (ADR 0033).
// `just vendor-terminal` runs it; its test checks the committed copy matches, like codegen-check.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PLUGIN = join(ROOT, "plugins/terminal");
export const VENDOR = join(PLUGIN, "ui/vendor");

/** Each package's files, by the name they get in ui/vendor. */
export const FILES = {
  "@xterm/xterm": {
    "xterm.mjs": "lib/xterm.mjs",
    "xterm.css": "css/xterm.css",
    "LICENSE.xterm": "LICENSE",
  },
  "@xterm/addon-fit": { "addon-fit.mjs": "lib/addon-fit.mjs", "LICENSE.addon-fit": "LICENSE" },
  "@xterm/addon-unicode11": {
    "addon-unicode11.mjs": "lib/addon-unicode11.mjs",
    "LICENSE.addon-unicode11": "LICENSE",
  },
};

const require = createRequire(join(PLUGIN, "package.json"));

function packageDir(name) {
  return dirname(require.resolve(`${name}/package.json`));
}

/** The installed version of every vendored package. */
export function versions() {
  return Object.fromEntries(
    Object.keys(FILES).map((name) => [
      name,
      JSON.parse(readFileSync(join(packageDir(name), "package.json"), "utf8")).version,
    ]),
  );
}

/** The source map comment goes: the maps are not vendored, so it would only point at a 404. */
function strip(text) {
  return text.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/u, "\n");
}

/** What ui/vendor must hold: file name -> text. */
export function expected() {
  const files = {};
  for (const [name, copies] of Object.entries(FILES)) {
    for (const [target, source] of Object.entries(copies)) {
      const text = readFileSync(join(packageDir(name), source), "utf8");
      files[target] = target.endsWith(".mjs") ? strip(text) : text;
    }
  }
  const pinned = Object.entries(versions())
    .map(([name, version]) => `${name} ${version}`)
    .join("\n");
  files.VERSIONS = `${pinned}\n`;
  return files;
}

export function vendor() {
  mkdirSync(VENDOR, { recursive: true });
  const files = expected();
  for (const [name, text] of Object.entries(files)) writeFileSync(join(VENDOR, name), text);
  return Object.keys(files).sort();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const name of vendor()) console.log(`vendored ${name}`);
}
