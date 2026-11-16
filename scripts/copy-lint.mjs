#!/usr/bin/env node
// copy-lint: the desk's words come from message catalogs (ADR 0250), so no source compares a
// language with "ko" to pick between two inline strings. A file that still does is in the baseline
// with its count, until a follow-up moves its words; a new one, or more of them, fails.
//
//   node scripts/copy-lint.mjs            check every source against the baseline (just check)
//   node scripts/copy-lint.mjs --update   write the baseline as the code stands
//   node scripts/copy-lint.mjs --list     print every file and its count
//
// Ratchet: scripts/copy-lint-baseline.json holds the counts a file may still have. A file not in
// it must have none; a count above its baseline fails; a file at zero must leave the baseline.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const BASELINE = join(ROOT, "scripts/copy-lint-baseline.json");
/** Where the desk's own sources live: the packages' src, the app's page, and the plugins. */
const DIRS = ["packages", "apps/desk/src", "plugins"];
const SKIP_DIRS = new Set(["node_modules", "dist", "vendor", "tests", "e2e", "dev", "target"]);
const SOURCE = /\.(ts|tsx|js|mjs)$/;
const TEST = /\.test\.(ts|tsx|js|mjs)$/;
/** A comparison with the Korean language, either way round, strict or not. */
const PAIR = /[!=]==?\s*["']ko["']|["']ko["']\s*[!=]==?/g;

/** How many inline comparisons with "ko" a source holds. */
export function count(source) {
  return source.match(PAIR)?.length ?? 0;
}

/** Every source with at least one, by its path from `root` with forward slashes. */
export function scan(root = ROOT) {
  const found = {};
  const walk = (abs) => {
    for (const name of readdirSync(abs).sort()) {
      const path = join(abs, name);
      if (statSync(path).isDirectory()) {
        if (!SKIP_DIRS.has(name) && !name.startsWith(".")) walk(path);
      } else if (SOURCE.test(name) && !TEST.test(name) && !name.endsWith(".d.ts")) {
        const n = count(readFileSync(path, "utf8"));
        if (n > 0) found[relative(root, path).split(sep).join("/")] = n;
      }
    }
  };
  for (const dir of DIRS) if (existsSync(join(root, dir))) walk(join(root, dir));
  return Object.fromEntries(Object.entries(found).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** What fails: new files with pairs, counts that grew, and files that no longer need their entry. */
export function compare(found, baseline) {
  const problems = [];
  for (const [file, n] of Object.entries(found)) {
    const allowed = baseline[file];
    if (allowed === undefined)
      problems.push(
        `${file}: ${n} inline "ko" pair(s); put the words in the module's messages/<lang>.json catalog (ADR 0250)`,
      );
    else if (n > allowed)
      problems.push(`${file}: ${n} inline "ko" pairs, the baseline allows ${allowed}`);
  }
  for (const file of Object.keys(baseline))
    if (!(file in found))
      problems.push(`${file}: no inline "ko" pairs left; take it out of the baseline (--update)`);
  return problems;
}

function main(args) {
  const found = scan();
  if (args.includes("--list")) {
    for (const [file, n] of Object.entries(found)) console.log(`${n}\t${file}`);
    return 0;
  }
  if (args.includes("--update")) {
    writeFileSync(BASELINE, `${JSON.stringify(found, null, 2)}\n`);
    console.log(`copy-lint: baseline written, ${Object.keys(found).length} files`);
    return 0;
  }
  const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
  const problems = compare(found, baseline);
  for (const problem of problems) console.error(`copy-lint: ${problem}`);
  const lower = Object.entries(found).filter(([file, n]) => n < (baseline[file] ?? n));
  for (const [file, n] of lower)
    console.log(`copy-lint: ${file} is down to ${n}; lower the baseline with --update`);
  if (problems.length === 0)
    console.log(`copy-lint: no new inline "ko" pairs (${Object.keys(found).length} files left)`);
  return problems.length === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  process.exitCode = main(process.argv.slice(2));
