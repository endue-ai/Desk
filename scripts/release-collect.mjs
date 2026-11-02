#!/usr/bin/env node
// Copy one target's Tauri bundles into the release folder under canonical names (ADR 0054):
// endue-desk_<version>_<target><ext>, each updater artifact with its .sig. Tauri names its output
// after the product ("endue Desk"), with spaces; R2 keys and URLs should not have them.
//   node scripts/release-collect.mjs --bundle target/<triple>/release/bundle --version V
//     --target darwin-aarch64|darwin-x86_64|windows-x86_64|linux-x86_64 --out dist
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** What each OS's bundle folder holds: updater artifacts are signed, first-install images are not. */
export const KINDS = {
  darwin: [
    { folder: "macos", match: /\.app\.tar\.gz$/u, ext: ".app.tar.gz", signed: true },
    { folder: "dmg", match: /\.dmg$/u, ext: ".dmg", signed: false },
  ],
  windows: [{ folder: "nsis", match: /-setup\.exe$/u, ext: "-setup.exe", signed: true }],
  linux: [
    { folder: "appimage", match: /\.AppImage$/u, ext: ".AppImage", signed: true },
    { folder: "deb", match: /\.deb$/u, ext: ".deb", signed: true },
    { folder: "rpm", match: /\.rpm$/u, ext: ".rpm", signed: true },
  ],
};

export const TARGETS = ["darwin-aarch64", "darwin-x86_64", "windows-x86_64", "linux-x86_64"];

/** Copy `target`'s bundles from `bundle` into `out`; answers the names written. */
export function collect({ bundle, version, target, out }) {
  if (!TARGETS.includes(target)) throw new Error(`unknown target ${target}`);
  mkdirSync(out, { recursive: true });
  const written = [];
  for (const kind of KINDS[target.split("-")[0]]) {
    const folder = join(bundle, kind.folder);
    const found = existsSync(folder)
      ? readdirSync(folder).filter((name) => kind.match.test(name))
      : [];
    if (found.length !== 1) {
      throw new Error(`expected one ${kind.ext} in ${folder}, found ${found.length}`);
    }
    const name = `endue-desk_${version}_${target}${kind.ext}`;
    copyFileSync(join(folder, found[0]), join(out, name));
    written.push(name);
    if (kind.signed) {
      const signature = join(folder, `${found[0]}.sig`);
      if (!existsSync(signature)) throw new Error(`no signature beside ${join(folder, found[0])}`);
      copyFileSync(signature, join(out, `${name}.sig`));
      written.push(`${name}.sig`);
    }
  }
  return written;
}

function main(args) {
  const value = (name) => {
    const at = args.indexOf(name);
    if (at < 0 || args[at + 1] === undefined) throw new Error(`${name} is missing`);
    return args[at + 1];
  };
  const names = collect({
    bundle: value("--bundle"),
    version: value("--version"),
    target: value("--target"),
    out: value("--out"),
  });
  for (const name of names) console.log(name);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`release-collect: ${error.message}`);
    process.exit(1);
  }
}
