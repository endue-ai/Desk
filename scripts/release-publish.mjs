#!/usr/bin/env node
// Upload to R2 in the order that keeps every listed build whole (ADR 0054): a release's artifacts
// with their signatures, then SHA256SUMS, then release.json with its signature; a channel index
// only after the release it lists. Builds never change once uploaded (immutable caching); indexes
// are cached for a minute. Uploads go through the S3 API (`aws s3`) at the R2 endpoint.
//   node scripts/release-publish.mjs release <dist> --version V   [common]
//   node scripts/release-publish.mjs index <index.json> --channel C   [common]
//   node scripts/release-publish.mjs remove --version V   [common]
//   common: --bucket B --endpoint URL [--prefix desk] [--dry-run]
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const IMMUTABLE = "public, max-age=31536000, immutable";
export const SHORT = "public, max-age=60";

const TYPES = [
  [/\.json$/u, "application/json"],
  [/\.sig$/u, "text/plain; charset=utf-8"],
  [/SHA256SUMS$/u, "text/plain; charset=utf-8"],
  [/\.tar\.gz$/u, "application/gzip"],
  [/\.exe$/u, "application/vnd.microsoft.portable-executable"],
  [/\.deb$/u, "application/vnd.debian.binary-package"],
  [/\.rpm$/u, "application/x-rpm"],
  [/\.dmg$/u, "application/x-apple-diskimage"],
];

export function contentType(name) {
  return TYPES.find(([pattern]) => pattern.test(name))?.[1] ?? "application/octet-stream";
}

const step = (file, key, cacheControl) => ({
  file,
  key,
  cacheControl,
  contentType: contentType(file),
});

/** A release folder's uploads, in order. `names` are the folder's file names. */
export function releasePlan({ dist, names, version, prefix = "desk" }) {
  if (!names.includes("release.json") || !names.includes("release.json.sig")) {
    throw new Error("the release folder needs release.json and release.json.sig");
  }
  const key = (name) => `${prefix}/releases/${version}/${name}`;
  const at = (name) => step(join(dist, name), key(name), IMMUTABLE);
  const special = new Set(["release.json", "release.json.sig", "SHA256SUMS"]);
  const artifacts = names.filter((n) => !n.endsWith(".sig") && !special.has(n)).sort();
  const plan = [];
  for (const name of artifacts) {
    plan.push(at(name));
    if (names.includes(`${name}.sig`)) plan.push(at(`${name}.sig`));
  }
  if (names.includes("SHA256SUMS")) plan.push(at("SHA256SUMS"));
  plan.push(at("release.json.sig"), at("release.json"));
  return plan;
}

/** A channel index's uploads: the signature, then the index. */
export function indexPlan({ index, channel, prefix = "desk" }) {
  const key = `${prefix}/channels/${channel}/index.json`;
  return [step(`${index}.sig`, `${key}.sig`, SHORT), step(index, key, SHORT)];
}

/** The `aws` arguments that upload one step. */
export function upload(stepToRun, { bucket, endpoint }) {
  return [
    "s3",
    "cp",
    stepToRun.file,
    `s3://${bucket}/${stepToRun.key}`,
    "--endpoint-url",
    endpoint,
    "--cache-control",
    stepToRun.cacheControl,
    "--content-type",
    stepToRun.contentType,
    "--only-show-errors",
  ];
}

/** The `aws` arguments that remove one release's folder. */
export function removal(version, { bucket, endpoint, prefix = "desk" }) {
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/u.test(version))
    throw new Error(`not a version: ${version}`);
  const folder = `s3://${bucket}/${prefix}/releases/${version}/`;
  return ["s3", "rm", folder, "--recursive", "--endpoint-url", endpoint, "--only-show-errors"];
}

function main([command, ...args]) {
  const value = (name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const need = (name) => value(name) ?? fail(`${name} is missing`);
  const target = {
    bucket: need("--bucket"),
    endpoint: need("--endpoint"),
    prefix: value("--prefix") ?? "desk",
  };
  const run = (argv) => {
    console.log(`aws ${argv.join(" ")}`);
    if (!args.includes("--dry-run")) execFileSync("aws", argv, { stdio: "inherit" });
  };
  if (command === "release") {
    const dist = args[0];
    if (!dist || !existsSync(dist)) fail("the release folder is missing");
    const plan = releasePlan({
      dist,
      names: readdirSync(dist),
      version: need("--version"),
      prefix: target.prefix,
    });
    for (const s of plan) run(upload(s, target));
  } else if (command === "index") {
    for (const s of indexPlan({
      index: args[0],
      channel: need("--channel"),
      prefix: target.prefix,
    })) {
      run(upload(s, target));
    }
  } else if (command === "remove") {
    run(removal(need("--version"), target));
  } else {
    fail("usage: release-publish.mjs release|index|remove ...");
  }
}

function fail(message) {
  throw new Error(message);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`release-publish: ${error.message}`);
    process.exit(1);
  }
}
