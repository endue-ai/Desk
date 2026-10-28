#!/usr/bin/env node
// docs-i18n: every user-facing English document has its five translations under docs/i18n/<lang>/,
// links each of them from a language line under its title, and each translation links back to its
// English original. Relative links in translations must resolve. Node 22, no dependencies.
//
//   node scripts/docs-i18n.mjs        (exit 1 and a list of problems when something is missing)

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const LANGS = ["ja", "zh", "fr", "de", "ko"];

/** User-facing documents. docs/ko/ holds the Korean design sources; those are not translations. */
export const DOCS = [
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "TRADEMARK.md",
  "docs/architecture.md",
  "docs/plugins/authoring.md",
];

/**
 * Where the `lang` translation of `doc` lives: docs/i18n/<lang>/ plus its path below docs/. A
 * repository path with forward slashes on every OS, as in the messages.
 */
export function translationPath(doc, lang) {
  return posix.join("docs/i18n", lang, doc.replace(/^docs\//, ""));
}

/** Relative markdown link targets in `text`, without anchors. */
export function relativeLinks(text) {
  const links = [];
  for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (target && !/^[a-z]+:/i.test(target)) links.push(target);
  }
  return links;
}

/** Problems found under `root`, as sentences. */
export function check(root = ROOT, docs = DOCS) {
  const problems = [];
  const read = (path) => readFileSync(join(root, path), "utf8");
  const linksTo = (from, text, to) =>
    relativeLinks(text).some((link) => resolve(root, dirname(from), link) === resolve(root, to));
  for (const doc of docs) {
    if (!existsSync(join(root, doc))) {
      problems.push(`${doc} is listed but does not exist`);
      continue;
    }
    const english = read(doc);
    for (const lang of LANGS) {
      const path = translationPath(doc, lang);
      if (!existsSync(join(root, path))) {
        problems.push(`${doc}: no ${lang} translation at ${path}`);
        continue;
      }
      if (!linksTo(doc, english, path))
        problems.push(`${doc}: the language line does not link ${path}`);
      const text = read(path);
      if (!linksTo(path, text, doc)) problems.push(`${path}: does not link back to ${doc}`);
      for (const link of relativeLinks(text)) {
        const target = relative(root, resolve(root, dirname(path), link));
        if (!existsSync(join(root, target))) problems.push(`${path}: broken link ${link}`);
      }
    }
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const problems = check();
  for (const problem of problems) console.error(`docs-i18n: ${problem}`);
  if (problems.length > 0) process.exit(1);
  console.log(`docs-i18n: ${DOCS.length} documents in ${LANGS.length} languages`);
}
