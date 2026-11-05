#!/usr/bin/env node
// The documents a release writes to R2 (ADR 0054; formats in docs/ko/updater-requirements.md):
// releases/<version>/release.json, the Tauri updater's static format plus a `desk` block, and
// channels/<channel>/index.json, the builds on one channel, newest first, with a serial that every
// write raises so a desk can refuse a stale copy. Signing and uploading happen elsewhere.
//   release <dist> --version V --base URL --notes URL --commit SHA [--min-from V] [--date ISO]
//   list <index.json> --channel C (--release <release.json> | --from <index.json> --version V)
//        [--rollout N]
//   rollout <index.json> --version V --percent N                           a listed build's share
//   unlist <index.json> --version V
//   prune <index.json> --out <file> [--days 14] [--keep <index.json>]...   prints versions to delete
//   pick <index.json> [--days 3]                                            prints a version or nothing
//   pick-candidate <index.json> --line release/vX.Y [--days 3]              prints "version commit"
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compare, lineOf, parse } from "./release-version.mjs";

const DAY = 24 * 60 * 60 * 1000;

/** The Tauri updater targets a canonical file serves, most specific first; none for a disk image. */
export function targetsOf(name, version) {
  const prefix = `endue-desk_${version}_`;
  if (!name.startsWith(prefix) || name.endsWith(".sig")) return [];
  const rest = name.slice(prefix.length);
  const rules = [
    [/^(darwin-(?:aarch64|x86_64))\.app\.tar\.gz$/u, (t) => [t, `${t}-app`]],
    [/^(windows-x86_64)-setup\.exe$/u, (t) => [`${t}-nsis`, t]],
    [/^(linux-x86_64)\.AppImage$/u, (t) => [`${t}-appimage`, t]],
    [/^(linux-x86_64)\.deb$/u, (t) => [`${t}-deb`]],
    [/^(linux-x86_64)\.rpm$/u, (t) => [`${t}-rpm`]],
  ];
  for (const [pattern, targets] of rules) {
    const m = pattern.exec(rest);
    if (m) return targets(m[1]);
  }
  return [];
}

/** The release folder's updater artifacts: name, size, sha256 and the text of its .sig. */
export function readDist(dist, version) {
  return readdirSync(dist)
    .filter((name) => targetsOf(name, version).length > 0)
    .sort()
    .map((name) => {
      const bytes = readFileSync(join(dist, name));
      const sig = join(dist, `${name}.sig`);
      if (!existsSync(sig)) throw new Error(`${name} has no signature`);
      return {
        name,
        size: statSync(join(dist, name)).size,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        signature: readFileSync(sig, "utf8").trim(),
      };
    });
}

/** release.json for `files`, every URL absolute under `base` (the Tauri updater needs that). */
export function releaseManifest({ version, base, notes, commit, date, minFrom, files }) {
  const platforms = {};
  const artifacts = {};
  for (const file of files) {
    const url = `${base.replace(/\/+$/u, "")}/releases/${version}/${file.name}`;
    for (const target of targetsOf(file.name, version)) {
      platforms[target] = { url, signature: file.signature };
      artifacts[target] = { sha256: file.sha256, size: file.size };
    }
  }
  if (Object.keys(platforms).length === 0) throw new Error(`no updater artifacts for ${version}`);
  const desk = { commit, ...(minFrom ? { minFrom } : {}), artifacts };
  return { version, notes, pub_date: date, platforms, desk };
}

/** The index entry for a release manifest. */
export function entryFor(release) {
  return {
    version: release.version,
    commit: release.desk.commit,
    date: release.pub_date,
    ...(release.desk.minFrom ? { minFrom: release.desk.minFrom } : {}),
    rollout: 100,
    targets: Object.keys(release.desk.artifacts).sort(),
    release: `releases/${release.version}/release.json`,
  };
}

const sorted = (releases) => [...releases].sort((a, b) => compare(b.version, a.version));

function next(index, channel, releases, now) {
  return { channel, serial: (index?.serial ?? 0) + 1, generated: now, releases: sorted(releases) };
}

/** `index` with `entry` on it (replacing the same version), serial raised. */
export function listed(index, entry, { channel, now }) {
  const others = (index?.releases ?? []).filter((r) => r.version !== entry.version);
  return next(index, channel, [entry, ...others], now);
}

/** A share of desks: an integer from 0 to 100. */
function share(percent) {
  const value = Number(percent);
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error(`${percent} is not a rollout share (0 to 100)`);
  }
  return value;
}

/** `entry` reaching `percent` of the desks. */
export function withRollout(entry, percent) {
  return { ...entry, rollout: share(percent) };
}

/** `index` with the listed `version` reaching `percent` of the desks, serial raised. */
export function rolledOut(index, version, percent, { now }) {
  const entry = index.releases.find((r) => r.version === version);
  if (!entry) throw new Error(`${version} is not on the ${index.channel} index`);
  return listed(index, withRollout(entry, percent), { channel: index.channel, now });
}

/** `index` without `version`; it must be there. */
export function unlisted(index, version, { now }) {
  if (!index.releases.some((r) => r.version === version)) {
    throw new Error(`${version} is not on the ${index.channel} index`);
  }
  const releases = index.releases.filter((r) => r.version !== version);
  return next(index, index.channel, releases, now);
}

/**
 * `index` without builds older than `days`, the newest always kept; `remove` names the dropped
 * versions whose files no index in `keep` still lists.
 */
export function pruned(index, { now, days = 14, keep = [] }) {
  const [newest, ...rest] = sorted(index.releases);
  const cutoff = Date.parse(now) - days * DAY;
  const old = rest.filter((r) => Date.parse(r.date) < cutoff);
  const dropped = new Set(old.map((r) => r.version));
  const elsewhere = new Set(keep.flatMap((other) => other.releases.map((r) => r.version)));
  const releases = [newest, ...rest.filter((r) => !dropped.has(r.version))].filter(Boolean);
  return {
    index: dropped.size ? next(index, index.channel, releases, now) : index,
    remove: [...dropped].filter((v) => !elsewhere.has(v)),
  };
}

/** The newest build that has been on `index` at least `days`, or undefined. */
export function promotable(index, { now, days = 3 }) {
  const cutoff = Date.parse(now) - days * DAY;
  return sorted(index.releases).find((r) => Date.parse(r.date) <= cutoff)?.version;
}

/**
 * The candidate a line's final builds (ADR 0092): the line's newest X.Y.Z-rc.N on `index`, once it has
 * been listed `days`. Undefined while there is none or it is younger; a newer candidate restarts the wait.
 */
export function soakedCandidate(index, { line, now, days = 3 }) {
  const want = lineOf(line);
  if (!want || !String(line).startsWith("release/"))
    throw new Error(`${line} is not a release line`);
  const candidates = sorted(index?.releases ?? []).filter((r) => {
    const v = parse(r.version);
    return v && v.major === want.major && v.minor === want.minor && v.pre[0] === "rc";
  });
  const newest = candidates[0];
  if (!newest || Date.parse(newest.date) > Date.parse(now) - days * DAY) return undefined;
  return newest;
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const print = (value) => console.log(JSON.stringify(value, null, 2));

function main([command, path, ...args]) {
  const values = (name) => args.flatMap((arg, i) => (arg === name ? [args[i + 1]] : []));
  const value = (name, fallback) => values(name)[0] ?? fallback;
  const need = (name) => {
    const found = value(name);
    if (found === undefined) throw new Error(`${name} is missing`);
    return found;
  };
  const now = value("--now", new Date().toISOString().replace(/\.\d{3}Z$/u, "Z"));
  switch (command) {
    case "release": {
      const version = need("--version");
      return print(
        releaseManifest({
          version,
          base: need("--base"),
          notes: need("--notes"),
          commit: need("--commit"),
          date: value("--date", now),
          minFrom: value("--min-from"),
          files: readDist(path, version),
        }),
      );
    }
    case "list": {
      const index = existsSync(path) ? readJson(path) : undefined;
      const release = value("--release");
      const entry = release
        ? entryFor(readJson(release))
        : readJson(need("--from")).releases.find((r) => r.version === need("--version"));
      if (!entry) throw new Error(`${value("--version")} is not on ${value("--from")}`);
      const rollout = value("--rollout");
      const placed = rollout === undefined ? entry : withRollout(entry, rollout);
      return print(listed(index, placed, { channel: need("--channel"), now }));
    }
    case "rollout":
      return print(rolledOut(readJson(path), need("--version"), need("--percent"), { now }));
    case "unlist":
      return print(unlisted(readJson(path), need("--version"), { now }));
    case "prune": {
      const keep = values("--keep").filter(existsSync).map(readJson);
      const result = pruned(readJson(path), { now, days: Number(value("--days", 14)), keep });
      writeFileSync(need("--out"), `${JSON.stringify(result.index, null, 2)}\n`);
      for (const version of result.remove) console.log(version);
      return;
    }
    case "pick": {
      const version = promotable(readJson(path), { now, days: Number(value("--days", 3)) });
      if (version) console.log(version);
      return;
    }
    case "pick-candidate": {
      const index = existsSync(path) ? readJson(path) : undefined;
      const days = Number(value("--days", 3));
      const found = soakedCandidate(index, { line: need("--line"), now, days });
      if (found) console.log(`${found.version} ${found.commit}`);
      return;
    }
    default:
      throw new Error(
        "usage: release-manifest.mjs release|list|rollout|unlist|prune|pick|pick-candidate <path> ...",
      );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`release-manifest: ${error.message}`);
    process.exit(1);
  }
}
