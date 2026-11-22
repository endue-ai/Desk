// GitHub release assets use the same signed release and index formats as the original R2 feed.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { entryFor, readDist, releaseManifest } from "./release-manifest.mjs";
import { parse } from "./release-version.mjs";

// Old installations compare every tagged manifest URL literally, even above their version floor.
const legacyDownload = "https://github.com/endue-ai/Desk/releases/download";
const read = (path) => JSON.parse(readFileSync(path, "utf8"));

function checkedVersion(version) {
  if (!parse(version) || version.startsWith("v")) throw new Error(`invalid version: ${version}`);
  return version;
}

/** The selected release's current listing, or an empty signed path after a withdrawal. */
export function tagPath(index, version) {
  checkedVersion(version);
  const entries = index.releases.filter((entry) => entry.version === version);
  return {
    ...index,
    releases: entries.map((entry) => ({
      ...entry,
      release: `${legacyDownload}/v${version}/release.json`,
    })),
  };
}

/** The existing preview feed with its signed manifests reachable from a GitHub attachment. */
export function previewPath(index, base) {
  return {
    ...index,
    releases: index.releases.map((entry) => ({
      ...entry,
      release: new URL(entry.release, `${base.replace(/\/+$/u, "")}/`).href,
    })),
  };
}

export function githubManifest(dist, version, commit, minFrom, repository = "endue-ai/Desk") {
  checkedVersion(version);
  if (repository !== "endue-ai/Desk" && repository !== "endue-ai/endue") {
    throw new Error("unexpected repository for the signed endue release feed");
  }
  const releases = `https://github.com/${repository}/releases`;
  return releaseManifest({
    version,
    downloadBase: `${releases}/download/v${version}`,
    commit,
    notes: `${releases}/tag/v${version}`,
    date: new Date().toISOString(),
    minFrom,
    files: readDist(dist, version),
  });
}

function main([mode, file, ...args]) {
  if (mode === "manifest") {
    const [version, commit, minFrom] = args;
    return githubManifest(file, version, commit, minFrom, process.env.GITHUB_REPOSITORY);
  }
  if (mode === "tag") return tagPath(read(file), args[0]);
  if (mode === "preview") return previewPath(read(file), args[0]);
  if (mode === "manual") {
    const release = read(file);
    const pre = parse(checkedVersion(release.version)).pre;
    const channel = pre.length === 0 ? "stable" : pre[0] === "rc" ? "beta" : "canary";
    return tagPath({ channel, serial: Date.now(), releases: [entryFor(release)] }, release.version);
  }
  throw new Error("expected manifest, tag, preview or manual");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  console.log(JSON.stringify(main(process.argv.slice(2)), null, 2));
}
