#!/usr/bin/env node
// What a GitHub Release a person published carries (release-macos.yml, ADR 0229): the macOS desk's
// disk images for Apple silicon and Intel under their canonical names (scripts/release-collect.mjs),
// and a macOS section in the release's notes that links them and says whether Apple knows the build.
//   node scripts/release-assets.mjs version v0.1.0                    prints 0.1.0, or fails
//   node scripts/release-assets.mjs files dist --version 0.1.0        prints the files to attach
//   node scripts/release-assets.mjs notes body.md --repo owner/name --tag v0.1.0 --version 0.1.0
//     --signed true|false                                             prints the notes with the section
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "./release-version.mjs";

export const MAC_TARGETS = [
  { target: "darwin-aarch64", label: "Apple silicon" },
  { target: "darwin-x86_64", label: "Intel" },
];
export const SUMS = "SHA256SUMS-macos";
const START = "<!-- release-macos:start -->";
const END = "<!-- release-macos:end -->";

/** The version a release tag names: `v0.1.0` or `v0.1.0-beta.2`, nothing else. */
export function tagVersion(tag) {
  const text = String(tag);
  const version = text.slice(1);
  if (!text.startsWith("v") || version.includes("+") || !parse(version) || /^v/u.test(version)) {
    throw new Error(`${text} is not a release tag (vX.Y.Z or vX.Y.Z-<pre>)`);
  }
  return version;
}

/** The disk images of `version`, one per macOS target. */
export function macImages(version) {
  return MAC_TARGETS.map(({ target }) => `endue-desk_${version}_${target}.dmg`);
}

export function cliFiles(version) {
  const archive = `endue-cli_${version}_linux-x86_64.tar.gz`;
  return [archive, `${archive}.sig`, "SHA256SUMS-cli"];
}

/** Downloadable CLI files and their verification data at the same tag as the app. */
export function cliSection({ repo, tag, version }) {
  const [archive, signature, sums] = cliFiles(version);
  const url = (name) => `https://github.com/${repo}/releases/download/${tag}/${name}`;
  return [
    "## endue CLI for Linux x86_64",
    "",
    `[${archive}](${url(archive)}) · [SHA-256](${url(sums)}) · [versioned signature](${url(signature)})`,
    "",
    "Verify the publisher with `gh attestation verify <archive> --repo endue-ai/endue`.",
    "Extract the verified archive and run `bin/endue` directly. Set `ENDUE_BRAIN_URL` and pass one quoted prompt to `endue run`.",
  ].join("\n");
}

/** The files in `dist` to attach: both disk images and their checksums; a missing one fails. */
export function macFiles(dist, version, exists = existsSync, cli = false) {
  const names = [...macImages(version), SUMS, ...(cli ? cliFiles(version) : [])];
  const missing = names.filter((name) => !exists(join(dist, name)));
  if (missing.length > 0) throw new Error(`${dist} lacks ${missing.join(", ")}`);
  return names;
}

/** The notes' macOS section. */
export function macSection({ repo, tag, version, signed, cli = false }) {
  const url = (name) => `https://github.com/${repo}/releases/download/${tag}/${name}`;
  const images = macImages(version);
  const lines = [
    START,
    cli ? "## endue app for macOS" : "## macOS",
    "",
    ...MAC_TARGETS.map(({ label }, at) => `- ${label}: [${images[at]}](${url(images[at])})`),
    "",
    `Checksums: [${SUMS}](${url(SUMS)}).`,
    "",
    signed
      ? "Signed with a Developer ID and notarised by Apple."
      : [
          "This build is not signed with a Developer ID and not notarised, so macOS refuses to open it",
          "the first time. Open it once, then allow it in System Settings > Privacy & Security > Open",
          cli
            ? "Anyway."
            : 'Anyway, or run `xattr -dr com.apple.quarantine "/Applications/endue Desk.app"`.',
        ].join(" "),
    ...(cli ? ["", cliSection({ repo, tag, version })] : []),
    END,
  ];
  return lines.join("\n");
}

/** `body` with the macOS section at its end, in place of the one an earlier run wrote. */
export function withMacSection(body, section) {
  let rest = String(body ?? "");
  const from = rest.indexOf(START);
  const to = rest.indexOf(END);
  if (from >= 0 && to > from) rest = rest.slice(0, from) + rest.slice(to + END.length);
  rest = rest.trim();
  return `${rest ? `${rest}\n\n` : ""}${section}\n`;
}

function main(args) {
  const value = (name) => {
    const at = args.indexOf(name);
    if (at < 0 || args[at + 1] === undefined) throw new Error(`${name} is missing`);
    return args[at + 1];
  };
  const [command, subject] = args;
  if (subject === undefined) throw new Error("usage: release-assets.mjs version|files|notes <arg>");
  if (command === "version") {
    console.log(tagVersion(subject));
  } else if (command === "files") {
    for (const name of macFiles(subject, value("--version"), existsSync, args.includes("--cli")))
      console.log(join(subject, name));
  } else if (command === "cli-section") {
    const version = tagVersion(`v${subject}`);
    console.log(cliSection({ repo: value("--repo"), tag: `v${version}`, version }));
  } else if (command === "notes") {
    const signed = value("--signed");
    if (signed !== "true" && signed !== "false") throw new Error("--signed takes true or false");
    const tag = value("--tag");
    const version = value("--version");
    if (tagVersion(tag) !== version) throw new Error(`${tag} is not version ${version}`);
    const section = macSection({
      repo: value("--repo"),
      tag,
      version,
      signed: signed === "true",
      cli: args.includes("--cli"),
    });
    process.stdout.write(withMacSection(readFileSync(subject, "utf8"), section));
  } else {
    throw new Error(`unknown command ${command}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`release-assets: ${error.message}`);
    process.exit(1);
  }
}
