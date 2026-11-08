#!/usr/bin/env node
// The version a release build carries (ADR 0054, ADR 0092). A release line is a branch release/vX.Y;
// its candidates are X.Y.Z-rc.<run>, Z the patch after the line's newest tag vX.Y.Z, and its final is
// the candidate without the suffix. A main (canary) build is the minor after the newest line or tag
// with -pre.<run> (0.5.0-pre.212 once release/v0.4 exists), or 0.1.0-pre.<run> before any: semver
// pre-releases, unique per run, above every line that exists.
//   node scripts/release-version.mjs --run 212 [--refs release/v0.4,v0.4.0]      canary
//   node scripts/release-version.mjs --line release/v0.4 --run 7 [--refs ...]   candidate
//   node scripts/release-version.mjs --final 0.4.0-rc.7                         final
//   node scripts/release-version.mjs --next-line [--refs ...]                   prints release/vX.Y
//   node scripts/release-version.mjs --new-line release/v0.5 [--refs ...]       fails unless newest
//   node scripts/release-version.mjs --notes-start 0.4.1 [--refs ...]           prints the tag notes start at
// Without --refs the refs are this checkout's release/v* branches on origin and its v* tags.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/u;
const LINE = /^release\/v(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const RC = /^(\d+\.\d+\.\d+)-rc\.(0|[1-9]\d*)$/u;

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

/** A release tag vX.Y.Z (no pre-release) as its version, or null. */
function releaseTag(ref) {
  if (!String(ref).startsWith("v")) return null;
  const parsed = parse(ref);
  return parsed && !parsed.pre.length ? parsed : null;
}

/** The line `{ major, minor }` a ref belongs to: a branch release/vX.Y or a tag vX.Y.Z; else null. */
export function lineOf(ref) {
  const branch = LINE.exec(String(ref));
  if (branch) return { major: +branch[1], minor: +branch[2] };
  const tag = releaseTag(ref);
  return tag ? { major: tag.major, minor: tag.minor } : null;
}

/** The line after the newest one among `refs`: release/v0.1 when there is none. */
export function nextLine(refs = []) {
  const lines = refs.map(lineOf).filter(Boolean);
  if (!lines.length) return "release/v0.1";
  const newest = lines.reduce((a, b) =>
    b.major > a.major || (b.major === a.major && b.minor > a.minor) ? b : a,
  );
  return `release/v${newest.major}.${newest.minor + 1}`;
}

/** `line` itself when it is a release line above every line among `refs`; otherwise it throws. */
export function newLine(line, refs = []) {
  const want = LINE.exec(String(line));
  if (!want) throw new Error(`${line} is not a release line (release/vX.Y)`);
  const next = lineOf(nextLine(refs));
  const [major, minor] = [+want[1], +want[2]];
  if (major < next.major || (major === next.major && minor < next.minor)) {
    throw new Error(
      `${line} is not above every line that exists; the next one is ${nextLine(refs)}`,
    );
  }
  return line;
}

/**
 * The tag a final's generated notes start at: the patch before it on its line, or for a line's .0
 * the newest .0 of an earlier line. Undefined for the first release.
 */
export function notesStart(version, refs = []) {
  const v = parse(version);
  if (!v || v.pre.length) throw new Error(`${version} is not a release version`);
  const tags = refs.map((ref) => [ref, releaseTag(ref)]).filter(([, t]) => t);
  const earlier = tags.filter(([, t]) =>
    v.patch > 0
      ? t.major === v.major && t.minor === v.minor && t.patch < v.patch
      : t.patch === 0 && (t.major < v.major || (t.major === v.major && t.minor < v.minor)),
  );
  return earlier
    .map(([ref]) => ref)
    .sort(compare)
    .at(-1);
}

const runOf = (run) => {
  if (!Number.isInteger(run) || run < 1) throw new Error("a build needs its run number");
  return run;
};

/** The canary version of run `run`: the next line's .0 with -pre.<run>. */
export function canaryVersion({ run, refs = [] }) {
  const { major, minor } = lineOf(nextLine(refs));
  return `${major}.${minor}.0-pre.${runOf(run)}`;
}

/** A candidate of `line` (release/vX.Y) for run `run`: the patch after the line's newest tag. */
export function candidateVersion({ line, run, refs = [] }) {
  const m = LINE.exec(String(line));
  if (!m) throw new Error(`${line} is not a release line (release/vX.Y)`);
  const [major, minor] = [+m[1], +m[2]];
  const patches = refs
    .map(releaseTag)
    .filter((t) => t && t.major === major && t.minor === minor)
    .map((t) => t.patch);
  const patch = patches.length ? Math.max(...patches) + 1 : 0;
  return `${major}.${minor}.${patch}-rc.${runOf(run)}`;
}

/** The final version of candidate `rc`: X.Y.Z-rc.N is X.Y.Z. */
export function finalVersion(rc) {
  const m = RC.exec(String(rc).replace(/^v/u, ""));
  if (!m) throw new Error(`${rc} is not a release candidate (X.Y.Z-rc.N)`);
  return m[1];
}

/** This checkout's release/v* branches on origin and its v* tags. */
export function localRefs() {
  return execFileSync(
    "git",
    ["for-each-ref", "--format=%(refname)", "refs/remotes/origin/release/", "refs/tags/"],
    { encoding: "utf8" },
  )
    .split("\n")
    .map((ref) =>
      ref
        .trim()
        .replace(/^refs\/remotes\/origin\//u, "")
        .replace(/^refs\/tags\//u, ""),
    )
    .filter(Boolean);
}

function main(args) {
  const value = (name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const final = value("--final");
  if (final) return console.log(finalVersion(final));
  const listed = value("--refs");
  const refs = listed === undefined ? localRefs() : listed.split(",").filter(Boolean);
  if (args.includes("--next-line")) return console.log(nextLine(refs));
  if (value("--new-line")) return console.log(newLine(value("--new-line"), refs));
  if (value("--notes-start")) {
    const tag = notesStart(value("--notes-start"), refs);
    if (tag) console.log(tag);
    return;
  }
  const run = value("--run") === undefined ? undefined : Number(value("--run"));
  const line = value("--line");
  console.log(line ? candidateVersion({ line, run, refs }) : canaryVersion({ run, refs }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`release-version: ${error.message}`);
    process.exit(1);
  }
}
