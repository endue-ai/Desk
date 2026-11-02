#!/usr/bin/env node
// The version a release build carries (ADR 0054). A tag v0.2.0 builds 0.2.0. A main build is the
// next patch after the latest tag with -pre.<run> (0.2.1-pre.48), or 0.1.0-pre.<run> before any tag:
// a semver pre-release, unique per run, above the last release and below the next one.
//   node scripts/release-version.mjs --tag v0.2.0
//   node scripts/release-version.mjs --run 48 [--latest v0.2.0]   (latest: the newest v* tag)
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/u;

/** `{ major, minor, patch, pre }` of a version without a leading v, or null. */
export function parse(version) {
  const m = SEMVER.exec(String(version).replace(/^v/u, ""));
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split(".") : [] };
}

/** Semver order: negative when a < b. Pre-releases sort below their release. */
export function compare(a, b) {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) throw new Error(`not a version: ${!x ? a : b}`);
  for (const key of ["major", "minor", "patch"]) if (x[key] !== y[key]) return x[key] - y[key];
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const [p, q] = [x.pre[i], y.pre[i]];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const [pn, qn] = [/^\d+$/u.test(p), /^\d+$/u.test(q)];
    if (pn && qn && +p !== +q) return +p - +q;
    if (pn !== qn) return pn ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/** The build version for a tag, or for main run `run` after the tag `latest` (none: no tag yet). */
export function buildVersion({ tag, run, latest }) {
  if (tag) {
    const version = String(tag).replace(/^v/u, "");
    const parsed = parse(version);
    if (!parsed || parsed.pre.length) throw new Error(`${tag} is not a release tag (vX.Y.Z)`);
    return version;
  }
  if (!Number.isInteger(run) || run < 1) throw new Error("a main build needs its run number");
  const last = latest ? parse(latest) : null;
  if (latest && (!last || last.pre.length)) throw new Error(`${latest} is not a release tag`);
  const next = last ? `${last.major}.${last.minor}.${last.patch + 1}` : "0.1.0";
  return `${next}-pre.${run}`;
}

/** The newest vX.Y.Z tag in this checkout, or undefined. */
export function latestTag() {
  const tags = execFileSync("git", ["tag", "--list", "v*"], { encoding: "utf8" })
    .split("\n")
    .map((t) => t.trim())
    .filter((t) => parse(t) && !parse(t).pre.length);
  return tags.sort(compare).at(-1);
}

function main(args) {
  const value = (name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const tag = value("--tag");
  const run = value("--run");
  const latest = tag ? undefined : (value("--latest") ?? latestTag());
  console.log(buildVersion({ tag, run: run === undefined ? undefined : Number(run), latest }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`release-version: ${error.message}`);
    process.exit(1);
  }
}
