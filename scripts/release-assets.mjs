#!/usr/bin/env node
// Release assets: turn the signed bundles of every platform build into the files a GitHub Release
// carries, with stable names, and the updater manifest (latest.json) that points at them.
//
// usage: node scripts/release-assets.mjs --version 1.2.3 --repo endue-ai/Desk --in artifacts --out release
//   --in holds one folder per build, desk-<target triple>, each a copy of target/<triple>/release/bundle.
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Target triples the release builds, and their updater platform keys. */
export const PLATFORMS = {
  "aarch64-apple-darwin": "darwin-aarch64",
  "x86_64-apple-darwin": "darwin-x86_64",
  "x86_64-pc-windows-msvc": "windows-x86_64",
  "x86_64-unknown-linux-gnu": "linux-x86_64",
};

/** Bundle kinds by file ending; `updater` marks the one the updater downloads on that OS. */
const KINDS = [
  { suffix: ".app.tar.gz", updater: true },
  { suffix: ".dmg" },
  { suffix: "-setup.exe", updater: true },
  { suffix: ".msi" },
  { suffix: ".AppImage", updater: true },
  { suffix: ".deb" },
  { suffix: ".rpm" },
];

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    // An .app bundle is a folder; its .app.tar.gz is what ships.
    if (statSync(path).isDirectory()) return name.endsWith(".app") ? [] : files(path);
    return [path];
  });
}

/** The assets to publish and the updater manifest, from the builds in `input`. */
export function collect({ input, version, repo, date = new Date().toISOString() }) {
  const base = `https://github.com/${repo}/releases/download/v${version}`;
  const assets = [];
  const platforms = {};
  const problems = [];
  for (const build of readdirSync(input).sort()) {
    const triple = build.replace(/^desk-/, "");
    const platform = PLATFORMS[triple];
    if (!platform) {
      problems.push(`${build}: unknown target ${triple}`);
      continue;
    }
    let updater = false;
    for (const path of files(join(input, build))) {
      const kind = KINDS.find((k) => path.endsWith(k.suffix));
      if (!kind) continue;
      const name = `endue-desk_${version}_${platform}${kind.suffix}`;
      assets.push({ from: path, name });
      if (!kind.updater) continue;
      let signature;
      try {
        signature = readFileSync(`${path}.sig`, "utf8").trim();
      } catch {
        problems.push(`${basename(path)} has no .sig: was TAURI_SIGNING_PRIVATE_KEY set?`);
        continue;
      }
      platforms[platform] = { signature, url: `${base}/${name}` };
      updater = true;
    }
    if (!updater) problems.push(`${build}: no updater bundle`);
  }
  const manifest = {
    version,
    notes: `https://github.com/${repo}/releases/tag/v${version}`,
    pub_date: date,
    platforms,
  };
  return { assets, manifest, problems };
}

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index > 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = argument("out");
  const { assets, manifest, problems } = collect({
    input: argument("in"),
    version: argument("version").replace(/^v/, ""),
    repo: argument("repo"),
  });
  for (const problem of problems) console.error(`release-assets: ${problem}`);
  if (problems.length > 0) process.exit(1);
  mkdirSync(out, { recursive: true });
  for (const { from, name } of assets) copyFileSync(from, join(out, name));
  writeFileSync(join(out, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`release-assets: ${assets.length} assets and latest.json in ${out}`);
}
